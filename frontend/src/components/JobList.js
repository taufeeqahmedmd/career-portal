import React, { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import Toaster from "./Toaster";
const JOBS_PER_PAGE = 6;

// Compact page list: 1 … around current … last
const pageWindow = (current, total) => {
  if (total <= 5) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = new Set([1, total, current - 1, current, current + 1]);
  const list = [...pages].filter((p) => p >= 1 && p <= total).sort((a, b) => a - b);
  const result = [];
  let prev = 0;
  for (const p of list) {
    if (p - prev > 1) result.push("…");
    result.push(p);
    prev = p;
  }
  return result;
};

const JobCard = ({ opening, onApply }) => {
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  const textRef = useRef(null);

  // Show "See more" only when the clamped text actually overflows two lines
  useEffect(() => {
    const el = textRef.current;
    if (el) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [opening.eligibility]);

  return (
    <div className="group bg-white border border-gray-200 rounded-2xl p-4 sm:p-5 shadow-sm hover:shadow-xl hover:border-[rgb(30,58,138)]/30 hover:-translate-y-1 transition-all duration-300 flex flex-col">
      {/* Top row: curriculum + type tags */}
      <div className="flex items-center justify-end gap-1.5 mb-2.5">
        {opening.curriculum && (
          <span className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-100 px-2.5 py-0.5 rounded-full">
            {opening.curriculum}
          </span>
        )}
        <span className="text-xs font-medium text-gray-400 bg-gray-50 px-2.5 py-0.5 rounded-full">
          Full-time
        </span>
      </div>

      {/* Title + branch */}
      <h3 className="text-base sm:text-lg font-bold text-[rgb(30,58,138)] font-poppins mb-0.5 group-hover:text-[#a81724] transition-colors">
        {opening.position}
      </h3>
      <div className="flex items-center gap-1.5 text-gray-500 mb-2">
        <svg className="w-4 h-4 text-[#a81724] flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
        <span className="text-sm">{opening.branch}</span>
      </div>

      {/* Eligibility - fixed 2-line slot (even when empty) so all cards stay the same height;
          expands in place only via "See more" */}
      <div className="mb-2">
        <p
          ref={textRef}
          className={`text-gray-500 text-sm leading-relaxed ${expanded ? "" : "clamp-2 min-h-[46px]"
            }`}
        >
          {opening.eligibility || ""}
        </p>
        <div className="h-5 mt-0.5">
          {(overflows || expanded) && (
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs font-semibold text-[rgb(30,58,138)] hover:text-[#a81724] transition-colors"
            >
              {expanded ? "See less ▲" : "See more ▼"}
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="mt-auto pt-2.5 border-t border-gray-50 flex items-center justify-between">
        {/*<span className="text-xs text-gray-400">Immediate joining preferred</span>*/}
        <button
          onClick={() => onApply(opening)}
          className="inline-flex items-center gap-1.5 bg-[#a81724] hover:bg-[#8a1420] text-white font-semibold py-2 px-4 rounded-full transition-colors text-sm shadow-md shadow-[#a81724]/15"
        >
          Apply Now
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
          </svg>
        </button>
      </div>
    </div>
  );
};

const JobOpenings = ({ openings = [], onApply, entity }) => {
  const [selectedPosition, setSelectedPosition] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  const [searchParams, setSearchParams] = useSearchParams();

  // Branch filter from the URL, e.g. /dps?branch=nacharam (a bare ?=nacharam works too)
  const branchFilter = (searchParams.get("branch") || searchParams.get("") || "").trim();

  useEffect(() => {
    const positionFromURL = searchParams.get("position");
    if (positionFromURL) {
      setSelectedPosition(positionFromURL);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedPosition, searchTerm, branchFilter]);

  const handleApply = (opening) => {
    if (onApply) {
      onApply(opening);
    }
  };

  const setPositionParam = (position) => {
    const next = new URLSearchParams(searchParams);
    if (position) next.set("position", position);
    else next.delete("position");
    setSearchParams(next);
  };

  const clearBranchFilter = () => {
    const next = new URLSearchParams(searchParams);
    next.delete("branch");
    next.delete("");
    setSearchParams(next);
  };

  const positions = [...new Set(openings.map((o) => o.position))];

  const filteredJobs = openings.filter((o) => {
    const positionMatch = selectedPosition ? o.position === selectedPosition : true;
    const branchMatch = branchFilter
      ? o.branch.toLowerCase().includes(branchFilter.toLowerCase())
      : true;
    const term = searchTerm.trim().toLowerCase();
    const searchMatch = term
      ? o.position.toLowerCase().includes(term) || o.branch.toLowerCase().includes(term)
      : true;
    return positionMatch && branchMatch && searchMatch;
  });

  const hasFilters = selectedPosition || searchTerm || branchFilter;

  const clearFilters = () => {
    setSelectedPosition("");
    setSearchTerm("");
    // Drop only the filter params - campaign tags on the URL must survive
    const next = new URLSearchParams(searchParams);
    ["position", "branch", ""].forEach((k) => next.delete(k));
    setSearchParams(next);
  };

  const totalPages = Math.ceil(filteredJobs.length / JOBS_PER_PAGE);
  const startIdx = (currentPage - 1) * JOBS_PER_PAGE;
  const paginatedJobs = filteredJobs.slice(startIdx, startIdx + JOBS_PER_PAGE);

  return (
    <>
      <section className="relative py-14 sm:py-20 px-4 sm:px-6 font-inter overflow-hidden" id="job-openings">
        {/* Background */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-amber-50/30"></div>
        <div className="absolute top-0 left-0 w-96 h-96 bg-[rgb(30,58,138)]/5 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2"></div>
        <div className="absolute bottom-0 right-0 w-96 h-96 bg-amber-400/10 rounded-full blur-3xl translate-x-1/2 translate-y-1/2"></div>

        <div className="relative max-w-7xl mx-auto">

          {/* Header */}
          <div className="text-center mb-9" data-aos="fade-up">
            <div className="flex items-center justify-center gap-3 mb-4">
              <div className="w-10 h-[2px] bg-[#a81724]"></div>
              <span className="text-[#a81724] text-sm font-semibold tracking-widest uppercase">Career Opportunities</span>
              <div className="w-10 h-[2px] bg-[#a81724]"></div>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[rgb(30,58,138)] font-poppins mb-3">
              Job Openings
            </h2>
            <p className="text-gray-500 text-sm sm:text-base">
              {filteredJobs.length} open position{filteredJobs.length !== 1 ? 's' : ''} across{' '}
              {entity ? entity.name : 'Delhi Public Schools & Pallavi Group'}
            </p>
            {branchFilter && (
              <button
                onClick={clearBranchFilter}
                className="inline-flex items-center gap-2 mt-3 bg-[rgb(30,58,138)]/10 hover:bg-[rgb(30,58,138)]/15 text-[rgb(30,58,138)] text-sm font-semibold px-4 py-1.5 rounded-full transition-colors"
                title="Remove branch filter"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
                Branch: {branchFilter}
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>

          {/* Toolbar: search + position filter */}
          <div className="bg-white/90 backdrop-blur-md border border-gray-100 rounded-2xl sm:rounded-full shadow-lg shadow-gray-200/40 p-2 sm:p-1.5 mb-8 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-1.5 max-w-3xl mx-auto">
            {/* Search */}
            <div className="relative flex-1 min-w-0">
              <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search position or branch…"
                className="w-full bg-gray-50 sm:bg-transparent rounded-full pl-11 pr-9 py-3 text-sm text-gray-700 placeholder-gray-400 outline-none focus:bg-gray-50 transition-colors"
              />
              {searchTerm && (
                <button
                  onClick={() => setSearchTerm("")}
                  aria-label="Clear search"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-colors"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" d="M18 6L6 18M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>

            {/* Divider */}
            <span className="hidden sm:block w-px h-7 bg-gray-200 shrink-0"></span>

            {/* Position dropdown - pill with custom chevron */}
            <div className="relative shrink-0 sm:w-56">
              <select
                className={`appearance-none w-full rounded-full pl-4 pr-10 py-3 text-sm outline-none cursor-pointer transition-colors ${selectedPosition
                    ? "bg-[rgb(30,58,138)] text-white font-medium"
                    : "bg-gray-50 sm:bg-transparent text-gray-700 hover:bg-gray-50"
                  }`}
                value={selectedPosition}
                onChange={(e) => {
                  const selected = e.target.value;
                  setSelectedPosition(selected);
                  setPositionParam(selected);
                }}
              >
                <option value="">All Positions</option>
                {positions.map((position, idx) => (
                  <option key={idx} value={position}>{position}</option>
                ))}
              </select>
              <svg
                className={`absolute right-4 top-1/2 -translate-y-1/2 w-3.5 h-3.5 pointer-events-none ${selectedPosition ? "text-white/80" : "text-gray-400"
                  }`}
                fill="none"
                stroke="currentColor"
                strokeWidth={2.5}
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {hasFilters && (
              <button
                onClick={clearFilters}
                aria-label="Reset all filters"
                title="Reset filters"
                className="shrink-0 w-full sm:w-11 h-10 sm:h-11 rounded-full bg-[#a81724]/10 hover:bg-[#a81724] text-[#a81724] hover:text-white flex items-center justify-center gap-2 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M4 10a8 8 0 0114-4M20 14a8 8 0 01-14 4" />
                </svg>
                <span className="sm:hidden text-sm font-semibold">Reset filters</span>
              </button>
            )}
          </div>

          {/* Job Cards Grid */}
          {paginatedJobs.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4 sm:gap-5">
              {paginatedJobs.map((opening) => (
                <JobCard key={opening.id} opening={opening} onApply={handleApply} />
              ))}
            </div>
          ) : (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100 shadow-sm">
              <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gray-50 flex items-center justify-center">
                <svg className="w-6 h-6 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11a6 6 0 11-12 0 6 6 0 0112 0z" />
                </svg>
              </div>
              <p className="text-gray-500 mb-3">No positions match your search or filters.</p>
              <button
                onClick={clearFilters}
                className="text-[rgb(30,58,138)] hover:text-[#a81724] font-semibold transition-colors"
              >
                View all positions →
              </button>
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4 mt-9">
              <p className="text-sm text-gray-500">
                Showing <span className="text-gray-800 font-medium">{startIdx + 1}–{Math.min(startIdx + JOBS_PER_PAGE, filteredJobs.length)}</span> of <span className="text-gray-800 font-medium">{filteredJobs.length}</span> openings
              </p>

              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                  disabled={currentPage === 1}
                  className={`w-10 h-10 rounded-full text-sm font-medium transition-colors flex items-center justify-center border ${currentPage === 1
                      ? 'text-gray-300 border-gray-100 cursor-not-allowed'
                      : 'text-gray-600 border-gray-200 bg-white hover:border-[rgb(30,58,138)]/40'
                    }`}
                  aria-label="Previous page"
                >
                  ←
                </button>

                {pageWindow(currentPage, totalPages).map((p, i) =>
                  p === "…" ? (
                    <span key={`e${i}`} className="w-8 text-center text-gray-400 select-none">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setCurrentPage(p)}
                      className={`w-10 h-10 rounded-full text-sm font-semibold transition-all ${currentPage === p
                          ? "bg-[rgb(30,58,138)] text-white shadow-md shadow-[rgb(30,58,138)]/25"
                          : "text-gray-600 bg-white border border-gray-200 hover:border-[rgb(30,58,138)]/40"
                        }`}
                    >
                      {p}
                    </button>
                  )
                )}

                <button
                  onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                  disabled={currentPage === totalPages}
                  className={`w-10 h-10 rounded-full text-sm font-medium transition-colors flex items-center justify-center border ${currentPage === totalPages
                      ? 'text-gray-300 border-gray-100 cursor-not-allowed'
                      : 'text-gray-600 border-gray-200 bg-white hover:border-[rgb(30,58,138)]/40'
                    }`}
                  aria-label="Next page"
                >
                  →
                </button>
              </div>
            </div>
          )}
        </div>
      </section>

      <Toaster />
    </>
  );
};

export default JobOpenings;
