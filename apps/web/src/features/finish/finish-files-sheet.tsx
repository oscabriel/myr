import { Option } from "effect";

import { Sheet, SheetContent } from "../../components/ui/sheet.tsx";
import { FinishFiles, useFinish } from "./finish-rail-body.tsx";

const FinishFilesSheet = ({
  onOpenChange,
  open,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
}) =>
  Option.match(useFinish(), {
    onNone: () => null,
    onSome: (found) => (
      <Sheet onOpenChange={onOpenChange} open={open}>
        <SheetContent side="left" title="Changed files">
          <div
            className="flex h-full min-h-0 flex-col"
            onClick={(event) => {
              if (
                event.target instanceof Element &&
                event.target.closest("a") !== null
              ) {
                onOpenChange(false);
              }
            }}
            role="presentation"
          >
            <FinishFiles finish={found} />
          </div>
        </SheetContent>
      </Sheet>
    ),
  });

// `React.lazy` takes a module's default export.
export default FinishFilesSheet;
