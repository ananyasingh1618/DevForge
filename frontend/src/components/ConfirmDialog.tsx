import { Button } from "./Button.js";
import { Modal } from "./Modal.js";

/** A confirmation dialog for destructive actions (e.g. disconnecting a
 * repository) — built on the shared Modal primitive rather than a native
 * `confirm()`, so it matches the rest of the design system and is
 * keyboard/focus accessible. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal open={open} onClose={onCancel} title={title} widthClassName="max-w-sm">
      <div className="flex flex-col gap-4 px-5 py-4">
        <p className="text-sm text-text-muted">{description}</p>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            type="button"
            variant={danger ? "danger" : "primary"}
            size="sm"
            loading={loading}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
