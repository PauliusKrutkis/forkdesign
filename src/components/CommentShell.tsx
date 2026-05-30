import type { ReactNode } from "react";
import { cn } from "../lib/utils";
import { Dialog, DialogContent } from "./ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs";

export type ShellTab = "list" | "settings";

interface CommentShellProps {
  children: ReactNode;
  listSubtitle?: string;
  onClose: () => void;
  onTabChange: (tab: ShellTab) => void;
  tab: ShellTab;
}

export function CommentShell({
  tab,
  onTabChange,
  onClose,
  listSubtitle,
  children,
}: CommentShellProps) {
  return (
    <div data-comment-overlay="true">
      <Dialog onOpenChange={(open) => !open && onClose()} open>
        <DialogContent
          className={cn(
            "flex h-[70vh] max-h-[85vh] min-h-[480px] w-full max-w-[460px] flex-col gap-0 overflow-hidden p-0"
          )}
          onClick={(e) => e.stopPropagation()}
        >
          <Tabs
            className="flex min-h-0 flex-1 flex-col"
            onValueChange={(v) => onTabChange(v as ShellTab)}
            value={tab}
          >
            <div className="flex shrink-0 items-center border-b py-3 pr-14 pl-4">
              <TabsList>
                <TabsTrigger value="list">Comments</TabsTrigger>
                <TabsTrigger value="settings">Settings</TabsTrigger>
              </TabsList>
            </div>

            {tab === "list" && listSubtitle ? (
              <p className="m-0 shrink-0 border-b px-4 py-2 text-muted-foreground text-xs">
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
