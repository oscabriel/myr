/**
 * Newer and Older, for a list read a page at a time (the log, the tags).
 * Each is a plain link to its page; a side with no page shows nothing.
 */
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";

export const Pager = ({
  newer,
  older,
}: {
  readonly newer?: string | undefined;
  readonly older?: string | undefined;
}) =>
  newer === undefined && older === undefined ? null : (
    <Pagination className="justify-between">
      <PaginationContent>
        {newer === undefined ? null : (
          <PaginationItem>
            <PaginationPrevious href={newer} text="Newer" />
          </PaginationItem>
        )}
      </PaginationContent>
      <PaginationContent>
        {older === undefined ? null : (
          <PaginationItem>
            <PaginationNext href={older} text="Older" />
          </PaginationItem>
        )}
      </PaginationContent>
    </Pagination>
  );
