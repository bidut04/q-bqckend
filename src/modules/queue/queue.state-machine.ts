import { BaseSecurityError } from "../../core/errors/security.errors";

export type QueueState =
  | "WAITING"
  | "CALLED"
  | "IN_SERVICE"
  | "HOLD"
  | "TRANSFERRED"
  | "REQUEUE"
  | "NO_SHOW"
  | "CANCELLED"
  | "COMPLETED"
  | "INTERRUPTED";

export class InvalidStateTransitionError extends BaseSecurityError {
  constructor(currentState: QueueState, targetState: QueueState) {
    super(
      `Invalid queue state transition from '${currentState}' to '${targetState}'`,
      400,
      "INVALID_STATE_TRANSITION",
      { currentState, targetState }
    );
  }
}

export class QueueStateMachine {
  private static readonly VALID_TRANSITIONS: Record<QueueState, readonly QueueState[]> = {
    WAITING: ["CALLED", "CANCELLED", "NO_SHOW"],
    CALLED: ["IN_SERVICE", "REQUEUE", "NO_SHOW", "CANCELLED"],
    IN_SERVICE: ["COMPLETED", "HOLD", "REQUEUE", "TRANSFERRED", "INTERRUPTED"],
    HOLD: ["IN_SERVICE", "WAITING", "CANCELLED"],
    TRANSFERRED: ["WAITING"],
    REQUEUE: ["WAITING"],
    NO_SHOW: [],
    CANCELLED: [],
    COMPLETED: [],
    INTERRUPTED: ["WAITING", "IN_SERVICE", "CANCELLED"],
  };

  /**
   * Validates if a state transition from currentState to targetState is allowed.
   * Throws InvalidStateTransitionError if transition is forbidden.
   */
  public static validateTransition(currentState: QueueState, targetState: QueueState): void {
    if (currentState === targetState) {
      return; // No-op transition
    }

    const allowed = this.VALID_TRANSITIONS[currentState] || [];
    if (!allowed.includes(targetState)) {
      throw new InvalidStateTransitionError(currentState, targetState);
    }
  }

  /**
   * Returns true if state is final (terminal state).
   */
  public static isTerminalState(state: QueueState): boolean {
    return state === "COMPLETED" || state === "CANCELLED" || state === "NO_SHOW";
  }
}
