/** Trusted composition ports; no browser capability action or execution authority. */
export type NativeLocator = {
  sessionId: string; messageId: string; position: number; historyEpoch: string | null;
};
export type OriginalCardOccurrence = { row: NativeLocator; blockIndex: number };
export type ResourcesReference = { owner: 'resources'; id: string };
export type RetainOriginalAttachmentV2 = {
  version: 2; commandId: string; target: OriginalCardOccurrence;
};
export type VerifiedOriginalAttachmentV2 = {
  version: 2; commandId: string;
  authority: {
    commandId: string; status: 'completed';
    source: { sessionId: string; historyRevision: string; throughMessageId?: string };
    target: { sessionId: string; creationHistoryRevision: string };
    creationConfirmed: true; preservedSource: true; workReplayed: false;
  };
  sourceOccurrence: OriginalCardOccurrence; targetOccurrence: OriginalCardOccurrence;
  card: {
    type: 'attachment'; reference: ResourcesReference; name: string;
    mimeType: string; size?: number; sha256?: string;
  };
  disposition: 'retained' | 'history-only';
  sourceHostSession: string; targetHostSession: string; engineId: string;
};
export type OriginalAttachmentGrantV2 = {
  version: 2; commandId: string; targetHostSession: string;
  originalReference: ResourcesReference;
  status: 'completed' | 'pending' | 'unknown' | 'refused';
  accessUri?: string; replayed: false;
};
/** Register on createResourcesCapability. Reads actual Native receipt and exact rows.
 * Absence, stale row, unknown Native creation or unsupported variant cannot verify.
 */
export type VerifyOriginalAttachment = (request: RetainOriginalAttachmentV2) =>
  Promise<VerifiedOriginalAttachmentV2 | null> | VerifiedOriginalAttachmentV2 | null;
export interface OriginalAttachmentPorts {
  retainForkAttachments(request: RetainOriginalAttachmentV2): Promise<OriginalAttachmentGrantV2>;
  resolveOriginalAttachment(targetHostSession: string, reference: ResourcesReference): Promise<OriginalAttachmentGrantV2 | null>;
}
