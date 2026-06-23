import { useState } from "react";

function useLocalStorage(key, init) {
  const [v, set] = useState(() => {
    try { return JSON.parse(localStorage.getItem(key)) ?? init; } catch { return init; }
  });
  return [v, (val) => { set(val); localStorage.setItem(key, JSON.stringify(val)); }];
}

const ChevronIcon = ({ open }) => (
  <svg className={`chevron${open ? " open" : ""}`} width="16" height="16" viewBox="0 0 16 16" fill="none">
    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function CollapsibleCard({ id, title, badge, subtitle, defaultOpen = true, children }) {
  const [open, setOpen] = useLocalStorage(`card-${id}`, defaultOpen);
  return (
    <div className="card">
      <button className="card-header" onClick={() => setOpen(!open)}>
        <div className="card-header-left">
          <span className="card-title">{title}</span>
          {badge != null && <span className="card-badge">{badge}</span>}
        </div>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div className="card-body">
          {subtitle && <p className="card-subtitle">{subtitle}</p>}
          {children}
        </div>
      )}
    </div>
  );
}
