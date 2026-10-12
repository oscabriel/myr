import type { ReactNode } from "react";

import { Sheet, SheetContent } from "../../../components/ui/sheet.tsx";
import { CommandSlotProvider } from "../keys.tsx";

const FactsSheet = ({
  content,
  heading,
  onOpenChange,
  open,
}: {
  readonly content: ReactNode;
  readonly heading: string;
  readonly onOpenChange: (open: boolean) => void;
  readonly open: boolean;
}) => (
  <Sheet onOpenChange={onOpenChange} open={open}>
    <SheetContent side="right" title={heading}>
      <CommandSlotProvider slot="facts">
        <div className="flex flex-col p-4">{content}</div>
      </CommandSlotProvider>
    </SheetContent>
  </Sheet>
);

export default FactsSheet;
