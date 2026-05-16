// Server-side IPC envelope and message payload contracts for orchestrator <-> map process control traffic.
import type {
  GenericOrchestratorResponse,
  MapHeartbeatRequest,
  MapRegistrationRequest,
  PersistCriticalEventRequest,
  PersistInventoryMutationRequest,
  PersistSnapshotBatchRequest,
  TransferRequest,
  TransferResponse,
  ValidateJoinTicketRequest,
  ValidateJoinTicketResponse
} from "./OrchestratorProtocol";

export type OrchestratorIpcMessageKind = "request" | "response" | "event";

export interface OrchestratorIpcEnvelope<TPayload = unknown> {
  messageKind: OrchestratorIpcMessageKind;
  messageType: string;
  correlationId: string | null;
  source: string;
  target: string;
  sentAtMs: number;
  payload: TPayload;
  ok?: boolean;
  error?: string;
}

export interface ReserveIncomingTransferRequest {
  transferId: string;
  accountId: number;
  fromMapInstanceId: string;
  toMapInstanceId: string;
  expiresAtMs: number;
}

export interface FinalizeSourceReleaseRequest {
  transferId: string;
  accountId: number;
  fromMapInstanceId: string;
  toMapInstanceId: string;
}

export interface TransferCompletedEvent {
  transferId: string;
  instanceId: string;
}

export interface OrchestratorIpcRequestMap {
  ConsumeJoinTicket: {
    request: ValidateJoinTicketRequest;
    response: ValidateJoinTicketResponse;
  };
  RequestTransfer: {
    request: TransferRequest;
    response: TransferResponse;
  };
  PersistSnapshotBatch: {
    request: PersistSnapshotBatchRequest;
    response: GenericOrchestratorResponse;
  };
  PersistCriticalEvent: {
    request: PersistCriticalEventRequest;
    response: GenericOrchestratorResponse;
  };
  PersistInventoryMutation: {
    request: PersistInventoryMutationRequest;
    response: GenericOrchestratorResponse;
  };
  ReserveIncomingTransfer: {
    request: ReserveIncomingTransferRequest;
    response: GenericOrchestratorResponse;
  };
  FinalizeSourceRelease: {
    request: FinalizeSourceReleaseRequest;
    response: GenericOrchestratorResponse;
  };
}

export interface OrchestratorIpcEventMap {
  MapProcessBooted: MapRegistrationRequest;
  MapHeartbeat: MapHeartbeatRequest;
  TransferCompleted: TransferCompletedEvent;
}

export function isOrchestratorIpcEnvelope(value: unknown): value is OrchestratorIpcEnvelope {
  if (!value || typeof value !== "object") {
    return false;
  }
  const envelope = value as Partial<OrchestratorIpcEnvelope>;
  return (
    (envelope.messageKind === "request" || envelope.messageKind === "response" || envelope.messageKind === "event") &&
    typeof envelope.messageType === "string" &&
    "payload" in envelope
  );
}
