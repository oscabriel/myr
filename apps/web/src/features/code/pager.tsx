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
