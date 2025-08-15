/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IStringDictionary } from '../../../../../base/common/collections.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { URI } from '../../../../../base/common/uri.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IMarkerService } from '../../../../../platform/markers/common/markers.js';
import { IChatService } from '../../../chat/common/chatService.js';
import { ILanguageModelsService } from '../../../chat/common/languageModels.js';
import { ToolProgress } from '../../../chat/common/languageModelToolsService.js';
import { ConfiguringTask, ITaskDependency, Task } from '../../../tasks/common/tasks.js';
import { ITaskService } from '../../../tasks/common/taskService.js';
import { ITerminalInstance } from '../../../terminal/browser/terminal.js';
import { pollForOutputAndIdle, getOutput, racePollingOrPrompt, promptForMorePolling } from './bufferOutputPolling.js';

export function getTaskDefinition(id: string) {
	const idx = id.indexOf(': ');
	const taskType = id.substring(0, idx);
	let taskLabel = idx > 0 ? id.substring(idx + 2) : id;

	if (/^\d+$/.test(taskLabel)) {
		taskLabel = id;
	}

	return { taskLabel, taskType };

}

export function getTaskRepresentation(task: IConfiguredTask | Task): string {
	if ('label' in task && task.label) {
		return task.label;
	} else if ('script' in task && task.script) {
		return task.script;
	} else if ('command' in task && task.command) {
		return typeof task.command === 'string' ? task.command : task.command.name?.toString() || '';
	}
	return '';
}

export async function getTaskForTool(id: string | undefined, taskDefinition: { taskLabel?: string; taskType?: string }, workspaceFolder: string, configurationService: IConfigurationService, taskService: ITaskService, allowParentTask?: boolean): Promise<Task | undefined> {
	let index = 0;
	let task: IConfiguredTask | undefined;
	const workspaceFolderToTaskMap = await taskService.getWorkspaceTasks();
	let configTasks: IConfiguredTask[] = [];
	for (const folder of workspaceFolderToTaskMap.keys()) {
		const tasksConfig = configurationService.getValue('tasks', { resource: URI.parse(folder) }) as { tasks: IConfiguredTask[] } | undefined;
		if (tasksConfig?.tasks) {
			configTasks = configTasks.concat(tasksConfig.tasks);
		}
	}
	for (const configTask of configTasks) {
		if ((!allowParentTask && !configTask.type) || ('hide' in configTask && configTask.hide)) {
			// Skip these as they are not included in the agent prompt and we need to align with
			// the indices used there.
			continue;
		}

		if ((configTask.type && taskDefinition.taskType ? configTask.type === taskDefinition.taskType : true) &&
			((getTaskRepresentation(configTask) === taskDefinition?.taskLabel) || (id === configTask.label))) {
			task = configTask;
			break;
		} else if (!configTask.label && id === `${configTask.type}: ${index}`) {
			task = configTask;
			break;
		}
		index++;
	}
	if (!task) {
		return;
	}

	let tasksForWorkspace;
	const workspaceFolderPath = URI.file(workspaceFolder).path;
	for (const [folder, tasks] of workspaceFolderToTaskMap) {
		if (URI.parse(folder).path === workspaceFolderPath) {
			tasksForWorkspace = tasks;
			break;
		}
	}
	if (!tasksForWorkspace) {
		return;
	}
	const configuringTasks: IStringDictionary<ConfiguringTask> | undefined = tasksForWorkspace.configurations?.byIdentifier;
	const configuredTask: ConfiguringTask | undefined = Object.values(configuringTasks ?? {}).find(t => {
		return t.type === task.type && (t._label === task.label || t._label === `${task.type}: ${getTaskRepresentation(task)}` || t._label === getTaskRepresentation(task));
	});
	let resolvedTask: Task | undefined;
	if (configuredTask) {
		resolvedTask = await taskService.tryResolveTask(configuredTask);
	}
	if (!resolvedTask) {
		const customTasks: Task[] | undefined = tasksForWorkspace.set?.tasks;
		resolvedTask = customTasks?.find(t => task.label === t._label || task.label === t._label);
	}
	return resolvedTask;
}

/**
 * Represents a configured task in the system.
 *
 * This interface is used to define tasks that can be executed within the workspace.
 * It includes optional properties for identifying and describing the task.
 *
 * Properties:
 * - `type`: (optional) The type of the task, which categorizes it (e.g., "build", "test").
 * - `label`: (optional) A user-facing label for the task, typically used for display purposes.
 * - `script`: (optional) A script associated with the task, if applicable.
 * - `command`: (optional) A command associated with the task, if applicable.
 *
 */
export interface IConfiguredTask {
	label?: string;
	type?: string;
	script?: string;
	command?: string;
	args?: string[];
	isBackground?: boolean;
	problemMatcher?: string[];
	group?: string;
}

export async function resolveDependencyTasks(parentTask: Task, workspaceFolder: string, configurationService: IConfigurationService, taskService: ITaskService): Promise<Task[] | undefined> {
	if (!parentTask.configurationProperties?.dependsOn) {
		return undefined;
	}
	const dependencyTasks = await Promise.all(parentTask.configurationProperties.dependsOn.map(async (dep: ITaskDependency) => {
		const depId: string | undefined = typeof dep.task === 'string' ? dep.task : dep.task?._key;
		if (!depId) {
			return undefined;
		}
		return await getTaskForTool(depId, { taskLabel: depId }, workspaceFolder, configurationService, taskService);
	}));
	return dependencyTasks.filter((t: Task | undefined): t is Task => t !== undefined);
}

/**
 * Collects output, polling duration, and idle status for all terminals.
 */
export async function collectTerminalResults(
	terminals: ITerminalInstance[], task: Task, languageModelsService: ILanguageModelsService, markerService: IMarkerService, chatService: IChatService, invocationContext: any, progress: ToolProgress, token: CancellationToken, isActive?: () => Promise<boolean>, dependencyTasks?: Task[]): Promise<Array<{ name: string; output: string; resources?: ILinkLocation[]; pollDurationMs: number; idle: boolean }>> {
	const results: Array<{ name: string; output: string; resources?: ILinkLocation[]; pollDurationMs: number; idle: boolean }> = [];
	for (const terminal of terminals) {
		progress.report({ message: new MarkdownString(`Checking output for \`${terminal.shellLaunchConfig.name ?? 'unknown'}\``) });
		let outputAndIdle = await pollForOutputAndIdle({ getOutput: () => getOutput(terminal.xterm?.raw), isActive, task, dependencyTasks }, false, token, languageModelsService, markerService);
		if (!outputAndIdle.terminalExecutionIdleBeforeTimeout) {
			outputAndIdle = await racePollingOrPrompt(
				() => pollForOutputAndIdle({ getOutput: () => getOutput(terminal.xterm?.raw), isActive, task, dependencyTasks }, true, token, languageModelsService, markerService),
				() => promptForMorePolling(task._label, token, invocationContext, chatService),
				outputAndIdle,
				token,
				languageModelsService,
				markerService,
				{ getOutput: () => getOutput(terminal.xterm?.raw), isActive, dependencyTasks },
			);
		}
		results.push({
			name: terminal.shellLaunchConfig.name ?? 'unknown',
			output: outputAndIdle?.output ?? '',
			pollDurationMs: outputAndIdle?.pollDurationMs ?? 0,
			idle: !!outputAndIdle?.terminalExecutionIdleBeforeTimeout,
			resources: outputAndIdle?.resources
		});
	}
	return results;
}

export interface ILinkLocation { uri: URI; range: Range }
