# DevForge demo: script

Video: `demo-assets/recordings/DevForge_demo_draft.mp4` (2:50, captions only). The video has no audio; the text below is the narration to read over it, and the on-screen captions match it. Every statement is backed by the repository README and the recorded behavior.

**Intro (0:00).** DevForge is a software engineering workspace. It turns a project idea into structured requirements, a PRD, an architecture, epics and tasks with an AI model, and it can answer questions about a connected code repository with citations. This recording is the real application running locally with fictional data.

**Architecture (0:05).** A React single-page app is served by Caddy, which forwards an allowlist of routes to a Node and Express API. The API uses PostgreSQL for everything, including sessions, versioned documents and a job queue. A separate FastAPI AI service talks to the language model, parses code with tree-sitter and requests embeddings.

**Pipeline (0:15).** For code questions and reviews, DevForge indexes a repository, chunks it along symbols, ranks chunks with a hybrid score, and gives the model at most eight numbered sources. The model can only pick source numbers, so it cannot invent a file or line. This part needs a GitHub token supplied by the user, so it is described here but not run live.

**Accounts and project (0:26).** I register an account. Sessions are opaque tokens in an HttpOnly cookie, with passwords hashed. Then I create a project called Riverside Library Loans.

**Requirements (0:40).** I describe the idea and start the analysis. This is a real request to the AI provider. The wait is sped up four times and labeled, and the real wait was 17 seconds. The result is a versioned set of requirements: summary, roles, risks, and functional and non-functional requirements, each marked as stated by me or inferred by the model.

**Chain (1:01).** From the active requirements I generate a PRD, from the PRD an architecture, then epics, then tasks. Each is a real request, each sped up and labeled with its real duration, and each becomes the active version that the next step builds on.

**Honest states (1:40).** Repository, indexing, Q&A and code review need a GitHub repository connection. Without one, DevForge says so plainly instead of producing made-up answers.

**Evaluation (2:05).** The repository includes an evaluation harness. This is a real run of its offline benchmark: 106 of 109 cases matched their exact expectation and every regression gate passed. It measures a small fixture dataset; it is not a claim of complete correctness.

**Jobs (2:26).** Long-running work can also run as background jobs in a durable queue stored in Postgres.

**Isolation (2:31).** A second account sees none of the first account's projects, and opening the first account's project address gives "not found", not "forbidden".

**Closing (2:41).** Shown live: accounts, isolation, the five-stage AI pipeline, and the evaluation results. Not shown live: repository indexing, search, Q&A and review, which are covered by tests and the evaluation harness.
