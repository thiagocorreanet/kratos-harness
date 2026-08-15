import type {
  AcquireLeaseRequest,
  LeaseObservation,
  LeaseOutcome,
  LeaseResource,
  ReleaseLeaseRequest,
  RenewLeaseRequest,
  TakeoverLeaseRequest,
} from "../domain/locks/index.js";

/** Durable authority over one closed project or run resource. */
export interface Locks {
  inspect(resource: LeaseResource): Promise<LeaseObservation>;
  acquire(request: AcquireLeaseRequest): Promise<LeaseOutcome>;
  renew(request: RenewLeaseRequest): Promise<LeaseOutcome>;
  release(request: ReleaseLeaseRequest): Promise<LeaseOutcome>;
  takeover(request: TakeoverLeaseRequest): Promise<LeaseOutcome>;
}
