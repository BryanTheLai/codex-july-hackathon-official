import type { OperationStatus } from "../contracts/workflow";
import "./operation-status.css";
import { Link } from "react-router";

export function OperationStatusBanner({
  status,
  onAction,
  actionAriaLabel,
}: {
  status: OperationStatus | null;
  onAction?: () => void;
  actionAriaLabel?: string;
}) {
  if (!status) {
    return null;
  }
  return (
    <div
      aria-live={status.state === "failed" ? "assertive" : "polite"}
      className={`operation-status operation-status--${status.state}`}
      role="status"
    >
      <span>{status.message}</span>
      {status.knowledgeCorrectionId && status.linkActionLabel ? (
        <Link to={`/knowledge?correction=${encodeURIComponent(status.knowledgeCorrectionId)}`}>
          {status.linkActionLabel}
        </Link>
      ) : null}
      {status.action && status.actionLabel && onAction ? (
        <button aria-label={actionAriaLabel} onClick={onAction} type="button">
          {status.actionLabel}
        </button>
      ) : null}
    </div>
  );
}
