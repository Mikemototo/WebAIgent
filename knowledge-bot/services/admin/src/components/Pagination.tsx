interface Props {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, total, onPageChange }: Props) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const disablePrev = page <= 1;
  const disableNext = page >= pages;

  return (
    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
      <button type="button" onClick={() => onPageChange(page - 1)} disabled={disablePrev}>
        Prev
      </button>
      <span style={{ fontSize: "12px", color: "#555" }}>
        Page {page} of {pages} ({total} items)
      </span>
      <button type="button" onClick={() => onPageChange(page + 1)} disabled={disableNext}>
        Next
      </button>
    </div>
  );
}
