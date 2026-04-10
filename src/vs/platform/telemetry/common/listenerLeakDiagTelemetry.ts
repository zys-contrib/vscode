/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import BaseErrorTelemetry, { ErrorEvent, ErrorEventFragment } from './errorTelemetry.js';

/**
 * GDPR-typed telemetry logger for {@link import('../../../base/common/event.js').ListenerLeakError}
 * and {@link import('../../../base/common/event.js').ListenerRefusalError}.
 *
 * The `publicLogError2` call site below is what the telemetry extractor discovers
 * for GDPR compliance. The classification extends {@link ErrorEventFragment} with
 * the diagnostic properties carried by the leak errors.
 */

type ListenerLeakEvent = ErrorEvent & {
	kind?: string;
	listenerCount?: number;
};

type ListenerLeakClassification = ErrorEventFragment & {
	kind?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Whether the leak is dominated by a single subscriber or popular among many.' };
	listenerCount?: { classification: 'SystemMetaData'; purpose: 'PerformanceAndHealth'; comment: 'Number of listeners on the emitter when the leak was detected.' };
};

BaseErrorTelemetry.registerDiagLogger('ListenerLeakError', (service, event) => {
	service.publicLogError2<ListenerLeakEvent, ListenerLeakClassification>('UnhandledError', event as ListenerLeakEvent);
});

BaseErrorTelemetry.registerDiagLogger('ListenerRefusalError', (service, event) => {
	service.publicLogError2<ListenerLeakEvent, ListenerLeakClassification>('UnhandledError', event as ListenerLeakEvent);
});
