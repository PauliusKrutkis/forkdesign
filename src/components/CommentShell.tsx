import type { ReactNode } from "react";
import { Dialog, DialogContent } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";
import { cn } from "../lib/utils";

export type ShellTab = "list" | "settings";

type CommentShellProps = {
  tab: ShellTab;
  onTabChange: (tab: ShellTab) => void;
  onClose: () => void;
  listSubtitle?: string;
  children: ReactNode;
};

export function CommentShell({
  tab,
  onTabChange,
  onClose,
  listSubtitle,
  children,
}: CommentShellProps) {
  return (
    <div data-comment-overlay="true">
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent
          className={cn(
            "flex h-[70vh] max-h-[85vh] min-h-[480px] w-full max-w-[460px] flex-col gap-0 overflow-hidden p-0",
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Tabs
            value={tab}
            onValueChange={(v) => onTabChange(v as ShellTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center border-b py-3 pl-4 pr-14">
              <TabsList>
                <TabsTrigger value="list">Comments</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>

            {tab === "list" && listSubtitle ? (
              <p className="m-0 shrink-0 border-b px-4 py-2 text-xs text-muted-foreground">
                {listSubtitle}
              </p>
            ) : null}

            <div className="redline-scroll min-h-0 flex-1 overflow-y-auto">
              {children}
            </div>
          </Tabs>
        </DialogContent>
      </Dialog>
    </div>
  );
}
