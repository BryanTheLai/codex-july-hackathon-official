import { Filter, Search, X } from "lucide-react";

import type { EvalFilters, EvalResultFilter } from "./eval-model";

function FilterFields({
  filters,
  languages,
  onChange,
}: {
  filters: EvalFilters;
  languages: string[];
  onChange: (filters: EvalFilters) => void;
}) {
  return (
    <>
      <label className="eval-filters__field eval-filters__split">
        <span>Use</span>
        <select
          aria-label="Filter by evaluation use"
          onChange={(event) =>
            onChange({ ...filters, split: event.target.value as EvalFilters["split"] })
          }
          value={filters.split}
        >
          <option value="all">All uses</option>
          <option value="train">Improve with</option>
          <option value="holdout">Verify only</option>
        </select>
      </label>
      <label className="eval-filters__field eval-filters__language">
        <span>Language</span>
        <select
          aria-label="Filter by language"
          onChange={(event) => onChange({ ...filters, language: event.target.value })}
          value={filters.language}
        >
          <option value="all">All languages</option>
          {languages.map((language) => (
            <option key={language} value={language}>
              {language}
            </option>
          ))}
        </select>
      </label>
      <label className="eval-filters__field eval-filters__result">
        <span>Result</span>
        <select
          aria-label="Filter by result"
          onChange={(event) =>
            onChange({ ...filters, result: event.target.value as EvalResultFilter })
          }
          value={filters.result}
        >
          <option value="all">All results</option>
          <option value="pass">Pass</option>
          <option value="fail">Fail</option>
          <option value="needs_review">Needs review</option>
          <option value="not_run">Not run</option>
        </select>
      </label>
    </>
  );
}

export function EvalFiltersBar({
  filters,
  languages,
  onChange,
  onOpenDrawer,
}: {
  filters: EvalFilters;
  languages: string[];
  onChange: (filters: EvalFilters) => void;
  onOpenDrawer: () => void;
}) {
  return (
    <section aria-label="Case filters" className="eval-filters">
      <label className="eval-filters__search">
        <Search aria-hidden="true" size={15} />
        <span className="visually-hidden">Search cases</span>
        <input
          aria-label="Search cases"
          onChange={(event) => onChange({ ...filters, query: event.target.value })}
          placeholder="Search cases"
          type="search"
          value={filters.query}
        />
      </label>
      <div className="eval-filters__fields">
        <FilterFields filters={filters} languages={languages} onChange={onChange} />
      </div>
      <button className="eval-filters__open" onClick={onOpenDrawer} type="button">
        <Filter aria-hidden="true" size={15} />
        Filters
      </button>
    </section>
  );
}

export function EvalFilterDrawer({
  filters,
  languages,
  onChange,
  onClear,
  onClose,
}: {
  filters: EvalFilters;
  languages: string[];
  onChange: (filters: EvalFilters) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <aside aria-label="Evaluation filters" className="eval-drawer eval-filter-drawer">
      <header className="eval-drawer__header">
        <strong>Filters</strong>
        <button aria-label="Close filters" className="eval-icon-button" onClick={onClose} type="button">
          <X aria-hidden="true" size={17} />
        </button>
      </header>
      <div className="eval-filter-drawer__fields">
        <FilterFields filters={filters} languages={languages} onChange={onChange} />
        <button className="eval-button" onClick={onClear} type="button">
          Clear filters
        </button>
      </div>
    </aside>
  );
}
