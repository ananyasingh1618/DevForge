# DevForge demo: shot list

Total runtime 2:50 (170.6 s). Timecodes are approximate positions in the final video.

| # | Timecode | Screen / action | Purpose | Duration | Narration (see script) | Expected result |
|---|---|---|---|---|---|---|
| 1 | 0:00 | Title slide | Set context | 5 s | Intro | Product name and one-line description |
| 2 | 0:05 | Architecture slide | Show real system shape | 10 s | Architecture | Browser, Caddy, API, Postgres, AI service |
| 3 | 0:15 | Retrieval and citation pipeline slide | Explain grounded answers, flag as not run live | 11 s | Pipeline | Six steps; note that it needs a GitHub token |
| 4 | 0:26 | Login page, then registration, projects page | Entry and sign in | ~7 s | Accounts | Account created, empty projects list |
| 5 | 0:33 | Create project "Riverside Library Loans" | Project creation | ~7 s | Project | Project workspace opens with pipeline status |
| 6 | 0:38 | Requirements page, idea typed | Start of the AI workflow | ~6 s | Idea | Text visible in the idea box |
| 7 | 0:46 | Requirements analysis (4x, real wait 17 s) | Real AI call | ~4 s | Waiting | Banner "SPED UP 4x", live timer |
| 8 | 0:50 | Requirements v1 open, FR-1 expanded | Structured, versioned output | ~10 s | Requirements | Summary, roles, risks, FR/NFR items tagged Stated or Inferred |
| 9 | 1:01 | PRD generation (4x, real 21 s) then result | AI generation from active version | ~10 s | PRD | PRD v1 active |
| 10 | 1:11 | Architecture generation (4x, real 25 s) then result | Chained generation | ~11 s | Architecture | Architecture v1 active |
| 11 | 1:23 | Epics generation (4x, real 20 s) then result | Chained generation | ~10 s | Epics | Epics v1 active |
| 12 | 1:33 | Tasks generation (4x, real 27 s) then result | Chained generation | ~11 s | Tasks | Tasks v1 active |
| 13 | 1:40 | Repository, Indexing, Q&A, Code Review pages | Honest empty states without a GitHub token | ~21 s | Honest states | "No repository connected"; nothing fabricated |
| 14 | 2:05 | Evaluations page, run expanded, scrolled | Measured quality | ~20 s | Evaluation | Passed, 106/109 cases, metric tables |
| 15 | 2:26 | Jobs page | Background job system | ~5 s | Jobs | Empty jobs list, job types offered |
| 16 | 2:31 | Second account: empty list, then first account's project URL | Isolation shown naturally | ~10 s | Isolation | Empty list, then "Project not found" |
| 17 | 2:41 | Closing slide | What was and was not shown | 10 s | Closing | Summary and limitations |
