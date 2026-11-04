# MarketClue v3 — competitive UX research

Prepared 2026-11-04 for the v3 rebuild described in `platform/SPEC.md` (v3 and Teams sections). It is the input
the `frontend-v3` task asks for.

**What this covers**
- **In depth:** 14 products. Nine are covered in depth: Perplexity, ChatGPT deep research, NotebookLM (now Gemini
  Notebook), Elicit, Consensus, Exa Websets, Gamma, Notion AI and Linear.
- **Market-data presentation:** five more. Similarweb, SparkToro, Exploding Topics, Glimpse, and GummySearch (now
  closed).
- **For each product:** first screen, how a task starts, history, effort choice, progress, citations,
  charts/tables, sharing/teams and accessibility.

**How it was researched, and its limits**
- **Search excerpts only.** All facts come from web searches of the vendors' own help centres, docs, changelogs,
  blogs and VPATs. The few third-party or user-forum sources are labelled as such. The sandbox's network policy
  blocked direct page fetches, so every claim rests on search-engine excerpts of the linked page, not on a full
  read or hands-on use.
- **Wording may differ.** Short quotes may be lightly reworded by the search tool. Check the live page before
  quoting it elsewhere.
- **Gaps are marked.** Anything we could not tie to a source is marked **unverified**. Exa's search UI, Exploding
  Topics and Glimpse got thin coverage because the shared search budget ran out.
- **Products change fast.** Several renamed or moved their modes in 2025–26. Dates are given where the sources
  gave them.
- **Contrast ratios** in §3.8 were computed for this document with the WCAG 2.x relative-luminance formula.

---

## 1. Summary: 10 patterns MarketClue should adopt

| # | Pattern | Who does it (see §2) | Why it fits MarketClue |
|---|---|---|---|
| 1 | **Exact-quote citations.** A numbered chip `[n]`; hovering shows the quote, clicking opens it in context. | NotebookLM cites direct quotes, shows the full quote on hover and jumps to the passage on click. Consensus has shown the exact quote on hover since Aug 2026. Elicit shows the supporting quote for any sentence. Perplexity and ChatGPT use numbered inline chips with a hover preview. | MarketClue already stores the exact quote, link and capture date for every Sourced statement. That is its core promise, so the quote — not just a link — should be one hover away. |
| 2 | **Evidence behind every table cell and chart bar, with an honest "unclear".** | Elicit opens the supporting quotes for any table cell and keeps them in CSV exports. Exa Websets stores reasoning, a yes/no/**unclear** verdict and references for each result and criterion. | The price table and charts are where founders decide. Each price needs its own chip, and "Not stated" must be a visible value. |
| 3 | **Clarify, then show a plan before a long run.** | Elicit's agent asks clarifying questions. ChatGPT deep research shows an editable plan before it starts. Gamma's Plan mode asks questions with tappable answers, then waits for approval. | This is exactly the research lead + brief card. Add tappable suggested answers, and treat "Start research" as approving the brief. |
| 4 | **The effort choice sits at the input, with plain trade-off copy and names that never change.** | Elicit has a Fastest→Smartest slider in the prompt box, with copy on time and usage. Consensus has a Deep toggle in the search bar. NotebookLM offers Fast vs Deep Research. Gamma offers Plan vs Express. | Quick ↔ Smarter, with "about 1.5 min · about $0.35" vs "about 3 min · $2–2.5", next to Start research. The disabled reason stays visible. |
| 5 | **Progress you can walk away from:** steps, sources being read, early findings, and a "done" notice. | Perplexity shows sources being read and early findings. Consensus shows its plan with paper counts and emails you when done. Elicit shows the current step and emails when a report is ready. | Runs take 1.5–3 minutes. Show a 5-step stepper, the agent rows and pages read. Say "You can close this tab", and the report appears in Recent. |
| 6 | **History in a quiet sidebar, plus a searchable, filterable full list.** | Linear Agent groups chat history by recency. Perplexity's History page has search and a type filter. ChatGPT, Notion, Consensus and Linear all use Ctrl/⌘K search. Elicit has Recents in the sidebar. | This is spec v3's Recent list (Today / This week / Earlier, with status chips) plus the Existing tab. Filter by the four tools and by status. |
| 7 | **A calm "inverted L" app shell built from a few derived tokens.** | Linear: a sidebar plus one consistent header controls the view. Share sits in a predictable place. The sidebar was dimmed so content leads. Themes are derived from base, accent and contrast inputs. | The owner asked for Linear quality. Six colour tokens and one type scale make it consistent, and make a high-contrast or dark theme cheap later. |
| 8 | **Evidence at a glance that holds back when evidence is thin.** | The Consensus Meter shows N, leaves out unclear papers and hides below 5. SparkToro calls its data "directional" and warns about small numbers. | The coverage bar and buyer-theme counts show *n*. Below 5 sourced quotes, show a sentence instead of a confident-looking bar. |
| 9 | **Estimates look different from sourced data, and missing data is shown, not filled in.** | Similarweb marks each point solid (confident), dotted (low confidence) or "!" (not enough data), and stamps measured GA4 data as "verified". Exploding Topics keeps its forecast as a separate toggle. | Estimates are hatched and labelled "≈ Estimate", with the method. Projections are always ranges in their own chart. "Not stated" rows have no bar. |
| 10 | **Share outputs, keep the working conversation private, and say so on screen.** | NotebookLM chat stays private inside a shared notebook. Perplexity Projects members can't see each other's memory. Consensus leaves threads out of shared collections. Elicit's view-only links need no account and can be turned off. | The Teams spec shares finished reports and fact cards but not conversations or running research. The Team page and Share dialog should state this in one sentence. |

**The single biggest opportunity:** in the documentation we could reach, no product combined all three of
quote-level evidence, an explicit Assumption/Estimate label on every other statement, and a capture date. This is
from docs, not hands-on use. NotebookLM and Consensus have
the quote, Similarweb has the estimate marking, and GummySearch had the link on every claim. MarketClue's v3 UI
should make that combination visible on every screen, starting with the landing hero.

---

## 2. Product notes

### At a glance

| Product | Effort / mode choice | Citation style | Long-run progress | History | Accessibility documentation |
|---|---|---|---|---|---|
| Perplexity | Mode from the "+" menu before submitting | Numbered inline, hover preview, click opens | Sources being read + early findings; done notification setting | History page: search, type filter | None found for the web app |
| ChatGPT deep research | Editable plan before the run; thinking levels renamed Jun 2026 | Inline, hover preview, Sources button; full-screen report with contents | Watch progress, interrupt/update | Ctrl/⌘K search, type filters, pins | VPAT listed on the trust portal (not read) |
| NotebookLM / Gemini Notebook | Fast vs Deep Research | Direct quotes; hover shows full quote; click jumps to passage | Runs in background; report + sources | Notebook list | VPAT 2.5, Dec 2025, partial support |
| Elicit | 5-step Fastest→Smartest slider (beta) | Click a sentence or cell → quote + reasoning | Step sidebar; email when done | Recents sidebar, Projects | WCAG 2.1 A "partially conformant" (Jan 2025) |
| Consensus | Pro default; Deep toggle | Hover shows exact quote; full-text check mark | Plan side panel with counts; email | Searchable History | None found |
| Exa Websets | Review proposed criteria; count drives cost | Per criterion: verdict yes/no/unclear + references | Matched vs evaluated counts | **Unverified** | **Unverified** |
| Gamma | Plan vs Express | Footnotes; web citations from agent | Agent narrates its progress | Gammas filters, folders | "VPAT? Not yet." |
| Notion AI | Auto vs a chosen model | Hyperlinked citations; meeting notes jump to transcript line | Background research (~5 min); agent activity logs | Sidebar, clock icon, Ctrl/⌘K | None found |
| Linear | — | — | Agent tab shows working state | Sidebar sections, Ctrl/⌘K, recency-grouped chat history | None found; font size and underline-links preferences |

### 2.1 Perplexity (search, Research, Projects — formerly Spaces, Pages)

**The names changed a lot in 2025–26, which is why older guides disagree:**
- "Deep Research" became "Research" ([help: Research mode](https://www.perplexity.ai/help-center/en/articles/10738684-what-is-research-mode)).
- On 6 Feb 2026 the modes moved into a "+" menu, and Labs became "Create files and apps" ([changelog 6 Feb 2026](https://www.perplexity.ai/changelog/what-we-shipped---february-6th-2026)).
- On 11 Jun 2026 Deep Research became a skill inside "Computer", Perplexity's agent product ([blog](https://www.perplexity.ai/hub/blog/deep-research-now-in-computer)).
- Spaces are now "Projects" ([blog](https://www.perplexity.ai/hub/blog/spaces-are-now-projects); date not verified).
- Threads are now "Sessions" ([help: threads](https://www.perplexity.ai/help-center/en/articles/10354769-what-is-a-thread)).
- "Create page" (Pages) is listed as "temporarily retired" ([help: Pages](https://www.perplexity.ai/help-center/en/articles/10352968-perplexity-pages)). We could not verify whether it has returned.

**First screen and how a task starts**
- One centred input with history in the sidebar ([getting started](https://www.perplexity.ai/hub/blog/getting-started-with-perplexity)). The exact 2026 layout is **unverified**.
- The "+" in the input holds file upload, sources and the mode: Deep Research, Model Council, Create files and apps, Learn step by step. The selected model is named in the bar ([changelog 6 Feb 2026](https://www.perplexity.ai/changelog/what-we-shipped---february-6th-2026)).
- The mode is chosen before you submit ([help: Research mode](https://www.perplexity.ai/help-center/en/articles/10738684-what-is-research-mode)).

**History**
- A History page at /library can be searched by keyword or title, filtered by type (e.g. Deep Research) and sorted ([help: find previous work](https://www.perplexity.ai/help-center/en/articles/19800007-find-projects-threads-and-previous-work)).
- Some sessions with attached files expire ([help: where did my threads go](https://www.perplexity.ai/help-center/en/articles/12637451-where-did-my-threads-go)).

**Effort**
- Research picks its own models. The help page says "most tasks in under 3 minutes", up to 4–5 minutes ([help: Research mode](https://www.perplexity.ai/help-center/en/articles/10738684-what-is-research-mode)).
- We did not find clarifying questions before a run (**unverified**).

**Progress**
- Advanced Deep Research shows which sources are being read, what has been learned and how the report is taking shape. Key findings appear early, and you can add follow-ups mid-run ([help: advanced deep research](https://www.perplexity.ai/help-center/en/articles/13600190-what-s-new-in-advanced-deep-research)).
- A setting controls the notification sent when Research finishes ([help: account settings](https://www.perplexity.ai/help-center/en/articles/10352990-account-settings)).

**Sources**
- Answers carry numbered inline citations; hovering previews the source and clicking opens it. Trust labels read "Government, Academic, Trusted" ([how Perplexity works](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work), [getting started hub](https://www.perplexity.ai/hub/getting-started)).
- Tabs at the top of a session switch to Links / Images / Videos ([changelog Dec 2025](https://www.perplexity.ai/changelog/what-we-shipped---december-5th)).
- Deep Research in Computer cites "every factual claim" ([blog](https://www.perplexity.ai/hub/blog/deep-research-now-in-computer)).
- Highlighting the quoted passage inside the source is **unverified**. The citation points to a page, not a sentence.

**Charts and tables**
- Interactive inline charts arrived on 5 Oct 2026 ([changelog](https://www.perplexity.ai/changelog/automations-inline-visualizations-and-gpt-6-1-sol)).
- Charts are "Artifacts" you can change in words ("swap this chart for a table") ([help: artifacts](https://www.perplexity.ai/help-center/en/articles/2026102801-what-are-artifacts)).

**Sharing and teams**
- Sessions are private by default. Share offers Private, Anyone with the link, or (Enterprise) Anyone in my org. A viewer's follow-up starts their own session. Export is PDF, Markdown or DOCX ([help: threads](https://www.perplexity.ai/help-center/en/articles/10354769-what-is-a-thread)).
- Projects have Owner / Can edit / Can view roles, and members can't see each other's memory or connected accounts ([help: projects](https://www.perplexity.ai/help-center/en/articles/10352961-what-are-projects)).
- Enterprise admins can turn off public sharing ([help: enterprise roles](https://www.perplexity.ai/help-center/en/articles/11187754-enterprise-roles-and-permissions)).

**Accessibility**
- We found no accessibility statement or VPAT for the web app (we could not confirm that none exists).
- The Comet browser help page says screen readers work and TalkBack is "not yet implemented" ([Comet accessibility](https://www.perplexity.ai/help-center/comet/en/articles/11583833-accessibility-on-comet)).

**Take for MarketClue**
- Numbered inline chips with a hover preview.
- Show sources being read and early findings while a run is going.
- Filter history by type; for MarketClue that means filtering by the four tools.

**Avoid**
- Renaming and re-hiding modes. Perplexity went from Deep Research → Research → "+" menu → Computer skill within about 18 months. Quick and Smarter should keep the same names in the same place.

### 2.2 ChatGPT deep research (plus ChatGPT citations and history)

**First screen and how a task starts**
- A prompt box with recent chats in the sidebar ([help: home page](https://help.openai.com/en/articles/9125172-the-chatgpt-home-page)). The composer gained a Tools menu in 2025, and since May 2026 the model choice also sits in the composer ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)).
- Deep research starts in one of three ways: type `/Deepresearch`, choose it from the + tools menu, or open it from the sidebar ([help: deep research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)).
- "Manage sites" limits research to chosen domains, or ranks them first (same page).

**Clarify, then plan (the key pattern)**
- In Chat, deep research shows a **proposed plan you can edit before it starts**. In Work/Codex it asks clarifying questions instead ([help: deep research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)).
- The editable plan, site focus, a sidebar entry and a full-screen report came in the 10 Feb 2026 update ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)).

**Effort**
- Thinking levels were renamed on 10 Jun 2026 to Medium / High / Extra High; "Light" was dropped ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)).
- The launch post gave 5–30 minutes per deep research run ([Introducing deep research, Feb 2025](https://openai.com/index/introducing-deep-research/)).

**History**
- Cmd/Ctrl+K searches chats, projects, images and files, including archived chats ([help: search history](https://help.openai.com/en/articles/10056348-how-do-i-search-my-chat-history-in-chatgpt)).
- Type filters arrived 14 Jul 2026. Pinning and grouping recents by project arrived 18 Jun 2026 ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)).
- Whether the sidebar still groups by date is **unverified**.

**Progress**
- You can watch progress and interrupt to change focus or sources ([help: deep research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)).
- A notification when done was promised at launch ([launch post](https://openai.com/index/introducing-deep-research/)); current behaviour is **unverified**.
- Users report runs stuck on "Researching…" ([community thread](https://community.openai.com/t/chatgpt-all-deep-research-request-failed-stuck-on-researching/1375197?page=3); user reports).

**Sources**
- Search answers have inline citations: hover previews on desktop, click opens. A "Sources" button at the end lists cited and related links ([help: ChatGPT search](https://help.openai.com/en/articles/9237897-chatgpt-search)).
- Deep research reports open full screen with a table of contents, a sources-used section and an activity history. They export to Markdown, Word or PDF ([help: deep research](https://help.openai.com/en/articles/10500283-deep-research-in-chatgpt)).
- Quote highlighting in the source is **unverified**.

**Charts**
- Interactive bar, line, pie and scatter charts in chat since 8 Jun 2026 ([release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes)).
- A "Switch to static chart" option, and CSV/PNG downloads ([help: data analysis](https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt)).

**Sharing and teams**
- Shared links from personal accounts are snapshots anyone with the link can open. Workspace links work only inside the workspace ([help: shared links FAQ](https://help.openai.com/en/articles/7925741-chatgpt-shared-links-faq)).
- Shared projects can be invite-only or link access ([help: projects](https://help.openai.com/en/articles/10169521-projects-in-chatgpt)).

**Accessibility**
- The trust portal lists a VPAT; we could not read it, so its date and contents are **unverified** ([trust.openai.com](https://trust.openai.com/)).
- A detailed user report describes JAWS regressions after a 25 Sep 2026 redesign: the model selector, the + menu, source previews and sidebar focus ([community report](https://community.openai.com/t/chatgpt-web-accessibility-with-jaws-detailed-report-and-technical-evidence/1404811); a user report, not confirmed by OpenAI).

**Take for MarketClue**
- An editable plan before a long run; the research lead's brief is exactly that.
- A report page with a table of contents, a sources-used list and an activity log.

**Avoid**
- Renaming effort levels.
- Custom menus that screen readers can't use. Use native radio buttons and `<dialog>`.

### 2.3 Google NotebookLM (renamed "Gemini Notebook", 16 Jul 2026)

The rename and new URL (notebook.google.com) are in Google's posts ([Google blog](https://blog.google/innovation-and-ai/products/gemini-notebook/notebooklm-gemini-notebook/), [Workspace Updates](https://workspaceupdates.googleblog.com/2026/07/notebooklm-now-gemini-notebook.html)).

**First screen**
- A list of notebooks with "Create new notebook". Inside a notebook there are three panels: **Sources | Chat | Studio**. Chat opens with a summary of your sources plus suggested questions ([help: overview](https://support.google.com/gemininotebook/answer/16206563?hl=en)).

**How a task starts**
- It starts from sources, not a prompt.
- **Fast Research** searches the web or Drive, and you tick or untick results before importing them.
- **Deep Research** is switched on with "Web" + "Deep Research" ([help: discover sources](https://support.google.com/gemininotebook/answer/16215270?hl=en&co=GENIE.Platform%3DDesktop)). Deep Research launched in Nov 2025 ([Google blog](https://blog.google/innovation-and-ai/models-and-research/google-labs/notebooklm-deep-research-file-types/)).

**Effort**
- An explicit two-level choice, Fast vs Deep; Deep takes "a couple of minutes" ([help: discover sources](https://support.google.com/gemininotebook/answer/16215270?hl=en&co=GENIE.Platform%3DDesktop)). This is the closest analogue to Quick/Smarter.
- "Configure chat" sets the style and the length ([help: configure chat](https://support.google.com/notebooklm/answer/14276569?hl=en)).

**History**
- The notebook is the unit of work, and notebooks don't share information ([help: overview](https://support.google.com/gemininotebook/answer/16206563?hl=en)).
- Chat history is saved and private to you, even in a shared notebook ([help: chat](https://support.google.com/notebooklm/answer/16179559?hl=en)). This is the same privacy split MarketClue's Teams spec uses: shared reports, private conversations.
- Answers can be saved as notes with their citations kept ([help: notes](https://support.google.com/gemininotebook/answer/16262519?hl=en)).

**Progress**
- Deep Research runs in the background while you keep working. It returns a report plus the relevant sources.
- Cancelling or minimising throws away anything not yet imported ([help: discover sources](https://support.google.com/gemininotebook/answer/16215270?hl=en&co=GENIE.Platform%3DDesktop)).

**Sources (the closest match to MarketClue's "Sourced")**
- Citations are **direct quotes from your sources**. Hover shows the full quote; click jumps to the passage in context ([help: chat & citations](https://support.google.com/gemininotebook/answer/16179559?hl=en)).
- A very short source is cited whole ([FAQ](https://support.google.com/gemininotebook/answer/16269187?hl=en)).
- Ticking sources in the Sources panel limits what chat uses ([help](https://support.google.com/notebooklm/answer/16179559?hl=en)).
- Whether chips are numbered is **unverified**.

**Charts and tables**
- Studio makes reports (export to Docs) and Data Tables (export to Sheets) ([help: overview](https://support.google.com/gemininotebook/answer/16206563?hl=en), [Data Tables post](https://blog.google/technology/google-labs/notebooklm-data-tables/)).
- Infographics gained preset styles in Mar 2026 ([Workspace Updates](https://workspaceupdates.googleblog.com/2026/03/new-ways-to-customize-and-interact-with-your-content-in-NotebookLM.html)).

**Sharing and teams**
- Share by email as Viewer or Editor, or by public link; a globe icon marks public notebooks.
- "Chat view" links hide sources but Google says this is **not** a security boundary ([help: sharing](https://support.google.com/gemininotebook/answer/16322204?hl=en)).
- Workspace admins control external sharing ([Workspace Updates, Sep 2026](https://workspaceupdates.googleblog.com/2026/09/manage-external-sharing-for-gemini-notebook-in-the-Admin-console.html)).

**Accessibility**
- Google publishes a NotebookLM VPAT 2.5, dated Dec 2025 and tested against WCAG 2.0–2.2 AA ([VPAT PDF](https://services.google.com/fh/files/misc/google_notebooklm_vpat.pdf), [Google accessibility index](https://www.google.com/accessibility/customers-partners/)).
- It reports "Partially Supports" for use without vision. Known issues include some functions not reachable by keyboard, a dialog that doesn't take focus, content lost at 200% zoom, and some text only as images. MarketClue's checklist (3.9) targets exactly these failures.

**Take for MarketClue**
- Hover shows the exact quote; click opens it in context.
- A single, obvious Fast/Deep choice.
- Private chats beside shared outputs.

**Avoid**
- Discarding work on cancel.
- "View-only" link modes that look like permissions but aren't.

### 2.4 Elicit (Research Agent, Reports, Systematic Review)

**First screen**
- The home page offers three starts: a Research Agent session, a Research Report or a Systematic Review ([help: which workflow](https://support.elicit.com/en/articles/14757543-getting-started-with-elicit-which-workflow-should-i-use)).
- Suggested skills sit under the prompt ([skills](https://support.elicit.com/en/articles/16647708-skills-in-elicit)).
- The left sidebar has Recents, Library and Projects ([session history](https://support.elicit.com/en/articles/14757548-session-history), [library](https://support.elicit.com/en/articles/14757550-elicit-s-library), [projects](https://support.elicit.com/en/articles/15805744-elicit-projects)).
- On 30 Sep 2026 Find Papers, Extract Data and Chat with Papers were folded into the Agent. Old sessions are now view-only and will be removed in 2027 ([help](https://support.elicit.com/en/articles/17220397-where-did-find-papers-extract-data-and-chat-with-papers-go), [changelog](https://support.elicit.com/en/articles/14823097-changelog)).

**How a task starts**
- Before searching, the agent asks clarifying questions: which sources to prioritise, how to structure the output, and where the scope ends ([help: research agent](https://support.elicit.com/en/articles/11241729), [blog](https://elicit.com/blog/introducing-research-agent-workflows)).
- Reports start from a question, a template (General Review / 1-Page Overview / Research Gap Analysis) and a speed, then Generate ([help: reports](https://support.elicit.com/en/articles/4168449)).

**Effort**
- The Agent has a five-step slider in the prompt box (beta), from **Fastest** to **Smartest**, with Balanced as the default.
- The help copy explains the trade-off in plain words. Higher effort reads more sources and uses more time and usage. It suggests the fast end for scoping and the smart end for work that must stand up to scrutiny ([help: research agent](https://support.elicit.com/en/articles/11241729)).
- Reports use a different set of names: fast / balanced / comprehensive ([help: reports](https://support.elicit.com/en/articles/4168449)).

**Progress**
- Reports show the current step in a sidebar. You can leave, and **Elicit emails you when it is done** ([help: reports](https://support.elicit.com/en/articles/4168449)).
- In the Agent you can watch which sources it is consulting in real time ([help: research agent](https://support.elicit.com/en/articles/11241729)).
- The API docs give 5–15 minutes as typical ([docs.elicit.com](https://docs.elicit.com/)).

**Sources (the core pattern)**
- Clicking within a report shows the **supporting quotes and reasoning** ([help: reports](https://support.elicit.com/en/articles/4168449)). Sentence-level citations show the supporting quote in a tooltip ([Elicit for education](https://elicit.com/industries/edu)).
- In tables, clicking any **cell** shows its supporting quotes, and CSV exports keep the quote and reasoning for each value ([help: systematic reviews](https://support.elicit.com/en/articles/14759154-systematic-reviews-in-elicit)).
- Every API citation has a required `quote` field ([docs.elicit.com](https://docs.elicit.com/)).
- Elicit's own write-up says low-confidence answers are "subtly" flagged ([blog: living documents](https://blog.elicit.com/living-documents-ai-ux/)).

**Charts and tables**
- The Agent creates tables, figures, slides and documents, listed under an "Artifacts" menu ([help: research agent](https://support.elicit.com/en/articles/11241729)).
- Bar charts, timelines and effect-size charts were added on 29 Apr 2026 ([changelog](https://support.elicit.com/en/articles/14823097-changelog)).
- Export is CSV/Excel, PDF/Word and .bib/.ris ([export help](https://support.elicit.com/en/articles/14758189-export-your-data-from-elicit)).

**Sharing and teams**
- The Share button sits top right, sharing by email or link with view or edit rights. A link is view-only, needs no account and can be turned off ([sharing help](https://support.elicit.com/en/articles/3175681)).
- Collaborative sessions (Sep 2026) tie each action to the person who made it and keep version history ([help](https://support.elicit.com/en/articles/16649941-collaborate-in-a-shared-research-agent-session), [blog](https://elicit.com/blog/ai-powered-research-is-now-multiplayer)).

**Accessibility**
- The accessibility statement is dated 22 Jan 2025 and says Elicit is "partially conformant with WCAG 2.1 level A". It gives a contact address ([statement](https://support.elicit.com/en/articles/4386433)).
- It predates the 2026 redesign. No VPAT was found (**unverified**).

**Take for MarketClue**
- Every sentence and every table or chart cell opens its quote and reasoning.
- Clarifying questions before the run.
- A step list during the run, and a "done" notice when you have left.

**Avoid**
- Separate tools that later have to be merged. MarketClue's four tools should be four *entry templates* into one conversation/run model, which is how the spec already treats `feature`.
- Two naming schemes for effort.
- "Subtle" confidence flags. MarketClue's labels must stay explicit.

### 2.5 Consensus (Pro / Deep search, Consensus Meter)

**First screen and how a task starts**
- Everything starts from the home search bar ([docs: first search](https://docs.consensus.app/get-started/run-your-first-search)).
- The bar has a sources dropdown and a "+" for attaching papers or PDFs. Filters cover year, study type and journal quality ([search best practices](https://help.consensus.app/en/articles/9922660-how-to-search-best-practices)).
- The sidebar has History, My Library and Collections ([history](https://help.consensus.app/en/articles/10068114-viewing-your-search-history), [library](https://docs.consensus.app/core-features/library)).
- Cmd+K opens search from anywhere ([threads](https://help.consensus.app/en/articles/11173143-searching-with-threads)).

**Effort**
- **Pro** is the default and reads up to 20 papers. **Deep** is a toggle in the search bar that turns blue when on, and a Pro answer can be upgraded to Deep afterwards ([docs: deep review](https://docs.consensus.app/get-started/deep-review)).
- The old "Quick" mode was renamed Paper Search (no AI summary) and moved under Tools at bottom left ([changelog](https://help.consensus.app/en/articles/11954907-consensus-product-changelog)).
- Deep has monthly caps per plan ([help: deep review](https://help.consensus.app/en/articles/11740827-how-to-use-deep-review)).

**Progress**
- Deep shows its plan and steps in a side panel, with counts of papers retrieved, eligible and included. You can leave the page ([docs: deep review](https://docs.consensus.app/get-started/deep-review), [deep search](https://docs.consensus.app/core-features/deep-search)).
- Consensus emails you when done (Aug 2025) ([help: deep review](https://help.consensus.app/en/articles/11740827-how-to-use-deep-review), [changelog](https://help.consensus.app/en/articles/11954907-consensus-product-changelog)).

**Sources**
- The answer is on the left and papers on the right. Grey inline tags link statements to papers ([docs: read an answer](https://docs.consensus.app/learn/read-a-consensus-answer)).
- Since 18 Aug 2026, **hovering a citation shows the exact quote**, and clicking opens the paper at that spot ([docs: citation grounding](https://docs.consensus.app/core-features/citation-grounding)).
- **A check mark shows the full text was read.** Without it, only the abstract and metadata were used (same page).
- Reference cards carry badges for study type, "Highly cited" and "Rigorous journal" ([docs: read an answer](https://docs.consensus.app/learn/read-a-consensus-answer)).
- The paper panel's Evidence tab lists the quotes the answer used ([docs: ask about a paper](https://docs.consensus.app/learn/ask-questions-about-a-paper)).

**The Consensus Meter (evidence at a glance)**
- It sorts papers into Yes / Possibly / Mixed / No, shows N, leaves out papers it can't classify confidently, and **doesn't show at all when fewer than 5 papers can be classified** ([help: Consensus Meter](https://help.consensus.app/en/articles/10069920-the-consensus-meter)).
- Meter 2.0 (Feb 2025) adds evidence-quality context for each position ([blog](https://consensus.app/home/blog/new-consensus-meter/)).
- Consensus itself notes the basic meter weights every paper equally ([blog](https://consensus.app/home/blog/consensus-meter/)).

**Charts and tables**
- A Claims & Evidence table gives each claim its strength of support, reasoning and key papers ([help: analysis & visuals](https://help.consensus.app/en/articles/17234045-consensus-ai-analysis-citations-and-visuals)).
- Figures from open-access papers and a Research Gaps Matrix were added in Sep 2026 ([changelog](https://help.consensus.app/en/articles/11954907-consensus-product-changelog)).

**Sharing and teams**
- Threads switch between Public and Private with Share at top right ([threads](https://help.consensus.app/en/articles/11173143-searching-with-threads)).
- Collections can be shared by email (Viewer/Editor) or invite link, but threads are not included ([share a collection](https://help.consensus.app/en/articles/15453733-how-to-share-a-collection-with-others)).

**Accessibility:** no statement or VPAT found on official domains (**unverified** that none exists).

**Take for MarketClue**
- Hovering a citation shows the exact quote.
- A "what we actually read" mark. MarketClue can distinguish "full page captured" from "search snippet only".
- A meter that **holds back when evidence is thin**. MarketClue's coverage bar should say "Too few quotes to summarise" below a threshold rather than draw a confident-looking bar.

**Avoid**
- A single tally that treats every source as equal.
- Burying a renamed mode under "Tools".

### 2.6 Exa Websets (structured web research)

**How a task starts**
- Describe what you want in plain English, **review the criteria and data columns Exa proposes**, then agents check each candidate against each criterion ([docs: get started](https://exa.ai/docs/websets/dashboard/get-started)).
- You can add enrichment columns (e.g. contacts, revenue, sentiment) and import an existing list to score ([imports](https://exa.ai/docs/websets/imports-and-search)).
- Exa recommends 5–7 enrichments ([best practices](https://exa.ai/docs/websets/best-practices)).

**Effort and cost:** we found no quick/deep switch. Cost scales with the number of results and enrichments ([FAQ](https://exa.ai/docs/websets/faq)). Pricing pages may be stale.

**Progress**
- The dashboard separates **matched** results from **evaluated** ones, which include rejected candidates ([exploring results](https://exa.ai/docs/websets/dashboard/walkthroughs/Exploring-your-results)).
- The API reports a 0–100% pass rate for each criterion ([API guide](https://exa.ai/docs/websets/api-guide-for-coding-agents)).

**Evidence (the strongest table pattern we found)**
- For every result and every criterion, the item stores the reasoning, a verdict of **yes / no / unclear**, and references (title, snippet, URL) ([API guide](https://exa.ai/docs/websets/api-guide-for-coding-agents), [get an item](https://exa.ai/docs/websets/api/websets/items/get-an-item)).
- Enrichment values also carry reasoning and references, with `null` when nothing was found ([get a webset](https://exa.ai/docs/websets/api/websets/get-a-webset)).
- In the dashboard, clicking a row opens a panel with a summary, the criteria met and clickable sources ([get started](https://exa.ai/docs/websets/dashboard/get-started)). Evidence on a single cell click is **unverified**.

**Tables:** results are a table with enrichment columns and CSV export ([sharing & downloading](https://exa.ai/docs/websets/dashboard/walkthroughs/Sharing-and-Downloading-Your-Results)). No charts were documented.

**Sharing and teams**
- A public toggle creates a link. **Free-plan Websets are public by default**; paid plans default to private (same page).
- Admins add members by email ([team members](https://exa.ai/docs/websets/dashboard/walkthroughs/Managing-Team-Members)).

**Could not verify:** the dashboard's home screen and history layout, accessibility, and Exa's search product UI. We could not reach the pages, and the search budget ran out.

**Take for MarketClue**
- In the competitor price table, each cell carries its value, kind, quote, link, capture date and a one-line reason.
- Allow an honest "unclear" (not found / not stated).
- Show "11 sellers checked, 6 shown" so rejected candidates aren't invisible.

**Avoid**
- Public-by-default sharing. Competitor research is sensitive, and MarketClue share links should stay opt-in per report, as in the spec.

### 2.7 Gamma (AI docs, decks and sites)

- **First screen and starting a task:**
  - Gamma 5 launched on 6 Oct 2026 ([announcement](https://gamma.app/insights/introducing-gamma-5-your-story-your-style-your-tools)). Creating now starts as a chat with an agent, and the dashboard keeps a "Use classic generator" link ([help: create](https://help.gamma.app/en/articles/7838093-how-do-i-create-a-new-presentation-document-or-webpage-in-gamma)).
  - The agent asks a few questions, each with tappable answer options plus free text. It then shows a plan covering story, style and look, and builds nothing until the user approves it ([help: agent](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)).
  - The classic flow offers Generate / Paste / Import, with an editable outline step before generating ([help: create](https://help.gamma.app/en/articles/7838093-how-do-i-create-a-new-presentation-document-or-webpage-in-gamma)).
- **Mode/effort:**
  - **Plan** (default): questions → plan → build. **Express** skips both the questions and the plan. Web research is only available in Plan ([help: agent](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)).
  - Credits are not charged for clarifying questions or for failed actions (same page).
- **History:** the left panel has Gammas (All / Recently viewed / Created by you / Favorites), Shared with you, Trash, and private-until-shared Folders ([dashboard](https://help.gamma.app/en/articles/11016390-introduction-to-the-gamma-dashboard), [folders](https://help.gamma.app/en/articles/15715069-how-do-i-use-folders-in-gamma)).
- **Progress:** the agent "researches, writes, designs, and generates images, narrating its progress as it works" ([help: agent](https://help.gamma.app/en/articles/15002203-how-do-i-create-with-agent-in-gamma)).
- **Sources:**
  - The agent can add web citations, and footnotes are the reference mechanism ([help: AI edit](https://help.gamma.app/en/articles/8033284-can-i-edit-my-content-using-ai), [footnotes](https://help.gamma.app/en/articles/11016428-how-do-i-use-toggles-nested-slides-and-footnotes-effectively)).
  - Users on Gamma's own forum complain about generated statistics without sources ([community thread](https://community.gamma.app/x/ideas-and-requests/2zqcuu7y4yep/issues-with-ai-data-accuracy-in-gamma-creations); user posts, not Gamma's position).
- **Charts:**
  - "Smart Charts" come from Insert → Charts & Diagrams or `/chart`, with data typed into an editable grid. They can sync one way from Google Sheets.
  - Imported charts may arrive as static images ([charts help](https://help.gamma.app/en/articles/11029098-how-can-i-generate-charts-and-diagrams-in-gamma)).
- **Sharing/teams:**
  - The Share button sits top right, with No access / View / Comment / Edit. Workspace settings override per-item settings ([sharing](https://help.gamma.app/en/articles/11047226-how-do-collaboration-and-sharing-settings-work-in-gamma)).
  - Analytics show unique viewers, slides viewed and time per slide. The help page openly says an anonymous viewer with 0 slides viewed "is almost always a link preview" ([analytics](https://help.gamma.app/en/articles/11047329-how-do-i-track-my-gamma-s-performance-using-analytics)).
  - Only admins invite; roles are Admin and Member ([invite](https://help.gamma.app/en/articles/11047939-how-can-i-add-users-to-my-workspace), [roles](https://help.gamma.app/en/articles/11047957-can-i-update-user-roles-in-my-gamma-workspace)).
- **Accessibility:**
  - Gamma's statement answers "VPAT? Not yet." There has been no formal audit, the UI is built on Chakra UI, and editable alt text is listed as a priority, not a shipped feature ([gamma.app/accessibility](https://gamma.app/accessibility)).
- **Take for MarketClue:** Plan vs Express maps almost exactly onto Smarter vs Quick: clarifying questions with tappable answers, then a plan the founder approves before money is spent. Also borrow the honest analytics copy.
- **Avoid:** statistics without sources, and two parallel generators (classic + agent) for the same job.
- **Could not verify:** exact home-screen layout; whether classic cards stream in one by one. The help pages could not be fetched directly; the facts above come from search excerpts of those official pages.

### 2.8 Notion AI (Notion Agent, Research Mode, AI Meeting Notes)

- **First screen and navigation:**
  - Home is a sidebar tab. Its sections include Recents, Favorites, Agents, Teamspaces, Shared and Private, with Library, Help and Trash pinned at the bottom ([sidebar help](https://www.notion.com/help/navigate-with-the-sidebar)).
  - Sidebar sections can be reordered, resized or hidden ([customize](https://www.notion.com/help/customize-your-sidebar)).
  - Cmd/Ctrl+K opens search, which starts with recent pages; Cmd/Ctrl+\ toggles the sidebar ([sidebar help](https://www.notion.com/help/navigate-with-the-sidebar)).
- **How a task starts:**
  - Notion Agent shipped with Notion 3.0 on 18 Sep 2025 ([release](https://www.notion.com/releases/2025-09-18)). It opens from a face icon at bottom right or from "New chat" in the sidebar, as a right panel or floating window.
  - Context comes from `@` mentions, an "All sources" picker or attachments ([Notion Agent help](https://www.notion.com/help/notion-agent)).
  - Past chats are named automatically and searchable behind a clock icon (same page).
- **Mode/effort:**
  - **Auto** routes simple requests to fast models and harder ones to stronger models. Users can instead pick a model, and models are compared by speed, intelligence and cost ([Auto help](https://www.notion.com/help/auto)).
  - Since the 19 Oct 2026 release, Auto uses "Standard" credits and a hand-picked model uses "Select" credits ([release](https://www.notion.com/releases/2026-10-19)).
  - Research Mode has a web-search on/off control ([Research Mode guide](https://www.notion.com/en-gb/help/guides/power-your-deep-work-using-research-mode-in-notion)).
  - The old Research Mode help URL now redirects to Notion Agent ([url](https://www.notion.com/help/research-mode)). That it was folded into Agent is our inference, **unverified**.
- **Progress:**
  - Research Mode works in the background while you keep working, for up to about 5 minutes ([guide](https://www.notion.com/en-gb/help/guides/power-your-deep-work-using-research-mode-in-notion)).
  - Custom Agents keep an activity log of each step ([custom agents](https://www.notion.com/help/custom-agents)).
- **Sources:**
  - Research Mode reports carry hyperlinked citations ([guide](https://www.notion.com/en-gb/help/guides/power-your-deep-work-using-research-mode-in-notion)). Enterprise Search "always cite[s] its sources" ([enterprise search](https://www.notion.com/help/enterprise-search)).
  - **Meeting Notes are the strongest pattern:** summary citations jump to the cited line of the transcript ([meeting notes](https://www.notion.com/help/ai-meeting-notes)). Since 17 Nov 2025 each takeaway links to the exact moment ([release](https://www.notion.com/releases/2025-11-17)).
  - The visual style of citations (numbered chip vs. hover preview) is **unverified**.
- **Charts:** chart views offer vertical/horizontal bar, line, donut and number; they are inserted with `/chart` and export as PNG/SVG ([charts](https://www.notion.com/help/charts)). Agent answers can include tables ([agent help](https://www.notion.com/help/notion-agent)).
- **Sharing/teams:**
  - Access levels are Full access / Can edit / Can comment / Can view. General access can be invited-only, the whole workspace, or anyone with the link (optionally expiring).
  - Outside emails join as guests, and "Publish to web" is a separate tab ([sharing & permissions](https://www.notion.com/help/sharing-and-permissions)).
- **Accessibility:** Notion's shortcut help says everything can be done from the keyboard ([shortcuts](https://www.notion.com/help/keyboard-shortcuts)). We found no VPAT or screen-reader statement (**not verified either way**).
- **Take for MarketClue:**
  - A citation should land on the exact span, not just the page. MarketClue already stores the exact quote, so the card should show it highlighted, never just a link.
  - Notion's Auto-vs-pick framing (speed vs. capability vs. cost) is a good template for the copy beside Quick/Smarter.
- **Avoid:** four different ways into AI (face icon, sidebar, shortcut, slash command), and two credit types the user has to understand.

### 2.9 Linear (the app-shell reference)

- **Shell structure:**
  - Linear's redesign write-up describes the global chrome as an "inverted L": the sidebar and the top header together control the main view ([How we redesigned the Linear UI](https://linear.app/now/how-we-redesigned-the-linear-ui)).
  - Headers and view controls are identical across object types, with Share / copy link in predictable places ([Behind the latest design refresh](https://linear.app/now/behind-the-latest-design-refresh)).
  - The 12 Mar 2026 refresh made the sidebar "slightly dimmer" so content stands out ([changelog](https://linear.app/changelog/2026-03-12-ui-refresh)).
  - Navigation chrome carries less visual weight, with fewer and smaller icons, while content stays dense ([design refresh post](https://linear.app/now/behind-the-latest-design-refresh)).
- **Sidebar:**
  - Inbox, then My Issues, then Favorites (with folders) above Your Teams ([my issues](https://linear.app/docs/my-issues), [favorites](https://linear.app/docs/favorites)).
  - Items can be reordered and hidden via "Customize sidebar" (18 Dec 2024, [changelog](https://linear.app/changelog/2024-12-18-personalized-sidebar)).
  - `[` collapses it ([changelog](https://linear.app/changelog/unpublished-collapsible-sidebar)).
  - Linear Agent (24 Mar 2026, [changelog](https://linear.app/changelog/2026-03-24-introducing-linear-agent)) keeps "Chat history" grouped by recency and shows a working state on agent tabs ([Linear Agent docs](https://linear.app/docs/linear-agent)).
- **Commands:** Cmd/Ctrl+K opens a fuzzy command menu that runs any action by name ([creating issues](https://linear.app/docs/creating-issues)). Single-key shortcuts are used heavily, e.g. `G` then `I` for Inbox, `J/K` to move ([inbox docs](https://linear.app/docs/inbox)).
- **Colour and type:**
  - Themes are generated in LCH from three inputs (base, accent, contrast) instead of 98 hand-set variables. Elevation colours are derived, and a contrast input produces high-contrast themes automatically ([redesign post](https://linear.app/now/how-we-redesigned-the-linear-ui)).
  - Type is Inter Display for headings and Inter for body (same post).
  - The 2026 refresh moved the default grey warmer and less saturated ([design refresh post](https://linear.app/now/behind-the-latest-design-refresh)).
- **Small details:** a "safe triangle" keeps submenus open while the pointer travels to them ([Invisible details](https://linear.app/now/invisible-details)).
- **Accessibility:**
  - Preferences include font size, a pointer cursor and underlined links ([account preferences](https://linear.app/docs/account-preferences)). The iOS app follows the system Increase Contrast setting ([Liquid Glass post](https://linear.app/now/linear-liquid-glass)).
  - We found no accessibility statement or VPAT. Focus-ring styling and reduced-motion support are **unverified**.
  - Sidebar width: no official figure. 240 px appears only in a third-party reconstruction, **unverified**.
- **Take for MarketClue:**
  - Copy the inverted-L shell: a quiet sidebar, one consistent header row with Share always in the same place, and dense content.
  - Derive all colours from a few tokens so a high-contrast or dark theme is cheap later.
  - Add Ctrl/⌘K search.
- **Avoid:**
  - Single-letter shortcuts without an off switch (WCAG 2.1.4) and keyboard-only discovery; solo founders need visible buttons.
  - Dimming the sidebar below 4.5:1.

### Market-data and founder-research tools

These five were studied mainly for how they present numbers, confidence and underlying evidence.

### 2.10 Similarweb (market data presentation)

**First screen**
- The Web Intelligence Homepage: you pick your site, a country and competitors. It shows traffic share and a share-of-voice view, with optional weekly alert emails ([Homepage help](https://support.similarweb.com/hc/en-us/articles/21826858593565-Web-Intelligence-Homepage)).
- AI Studio is a separate chat with a mode selector (Chat / Deep Research / AI Dashboards) and recent conversations, for select customers ([Using AI Studio](https://support.similarweb.com/hc/en-us/articles/33816102143133-Using-AI-Studio)).

**How a task starts**
- Enter a domain. "Compare" adds up to 4 rivals, with filters for period, region and device ([Website Performance](https://support.similarweb.com/hc/en-us/articles/360010749958-View-Website-Performance)).
- Your own site is always dark blue; each competitor gets its own colour (same page).

**Confidence and missing data (the best pattern in this group)**
- Segment Analysis marks each month: a **full dot = high confidence**, a **dotted line with an estimate = low confidence**, and **"!" = not enough data** ([Segment Analysis FAQ](https://support.similarweb.com/hc/en-us/articles/11083436762781-Segment-Analysis-FAQs)).
- Elsewhere it says "Not enough data" outright rather than drawing something ([What does "Not enough data" mean](https://support.similarweb.com/hc/en-us/articles/207698639-What-does-Not-enough-data-mean)).
- The Data Accuracy page says small sites have higher variance, that Similarweb is more confident above roughly 100K monthly visits, and that it may withhold data ([Data accuracy](https://support.similarweb.com/hc/en-us/articles/360002219177-Similarweb-s-Data-Accuracy)).
- When a site connects GA4, the measured metrics carry a Google icon and a "verified" stamp, and users can switch between measured and estimated values ([Connecting GA4](https://support.similarweb.com/hc/en-us/articles/11550839331613-Connecting-GA4-to-Similarweb)).

**Evidence:** numbers come from a model. Sources are named only at methodology level, not per number ([Data accuracy](https://support.similarweb.com/hc/en-us/articles/360002219177-Similarweb-s-Data-Accuracy)).

**Sharing:** dashboards export to PDF and PPT and are shared with users inside your company account ([Build a dashboard](https://support.similarweb.com/hc/en-us/articles/360010602497-Build-a-Dashboard)).

**Accessibility:** no statement or VPAT found (**unverified**).

**Take for MarketClue:** use a different mark per data quality. Sourced values are solid, estimates are hatched or dotted, and missing values show an explicit "Not stated" or "Not enough data". Never draw a zero-length bar.

### 2.11 SparkToro (audience research)

**First screen and how a task starts**
- Since **V3** (Aug 2026), "My Projects" is the home page and the charts were redone ([V3 post](https://sparktoro.com/blog/the-brand-new-v3-of-sparktoro-is-here/), [product updates](https://sparktoro.com/product-updates)).
- Searches are written as sentences, such as "My audience frequently talks about…" or "…visits the website" ([first ten searches](https://sparktoro.com/blog/how-to-use-your-first-ten-sparktoro-searches/)).
- An audience can also be described in plain words; an LLM turns the description into profile traits ([describable audiences post](https://sparktoro.com/blog/starting-today-anyone-can-analyze-any-describable-audience-in-sparktoro/)).

**History:** every report auto-saves to Projects, and reopening doesn't use another report from the monthly allowance ([find past reports](https://sparktoro.com/support/faq/find-past-reports)).

**How data is shown**
- The FAQ calls the data **"directional"**. Big audiences are more stable, niche ones are noisier, and you should check high-stakes decisions against your own data ([accuracy & bias](https://sparktoro.com/support/faq/accuracy-and-bias)).
- An older post describes coarse confidence buckets that depend on sample size ([polls vs results post](https://sparktoro.com/blog/election-polls-vs-results-can-help-explain-how-sparktoros-data-works/)). Whether V3 still shows them is **unverified**.
- SparkToro advises reading changes against the base "so as not to be biased by big changes among small numbers" ([Search vs AI tools post](https://sparktoro.com/blog/are-your-customers-switching-to-ai-tools-and-how-much-sparktoros-new-search-ai-tools-feature-has-the-answers/)).
- The affinity score scale is described as 1–100 in the V2 launch post ([V2 post](https://sparktoro.com/blog/sparktoro-v2-is-finally-here-it-can-do-incredible-things-for-seo-content-marketing-pr-and-ad-targeting/)) but 0–100 in the help page ([affinity scores](https://sparktoro.com/support/faq/affinity-scores)). The docs disagree.
- Market size (TAM) has been shown at the top of reports since Jun 2026, with a methodology breakdown ([TAM FAQ](https://sparktoro.com/support/faq/market-size-tam), [TAM post](https://sparktoro.com/blog/total-addressable-market-tam-size-is-now-in-sparktoro-reports/)). Whether it is shown as a range is **unverified**.
- SparkToro published a correction after one graph used the wrong underlying signal ([correction post](https://sparktoro.com/blog/how-much-is-your-audience-searching-google-vs-prompting-ai-tools-sparktoros-answers-just-got-an-upgrade/)).

**Sharing:** CSV export, shareable lists, seats per plan ([pricing](https://sparktoro.com/pricing)).

**Accessibility:** no statement or VPAT found (**unverified**).

**Take for MarketClue**
- Put a plain-words confidence line on every chart ("Based on 7 quotes from 4 pages — directional").
- Show *n* on the buyer-theme bars; don't turn small counts into percentages.
- Keep a visible "Method changes" note if the report logic changes.

### 2.12 Exploding Topics (trend charts) — thin coverage

- Topics are found by AI across sources such as Reddit, Amazon and YouTube, then approved by human analysts ([methodology](https://explodingtopics.com/methodology), [how to use](https://explodingtopics.com/blog/how-to-use-et)).
- Charts are based on Google search volume, spanning 3 months to 15 years, and trends are labelled Regular / Peaked / Exploding (same pages).
- The **12-month forecast is a toggle on the trend chart**, from "a deep learning model" ([trend forecasting](https://explodingtopics.com/blog/trend-forecasting)). How the forecast line is drawn (dashed? a band?) is **unverified**.
- **Could not verify:** first screen, saving, sharing, accessibility. Our search budget ran out after one query.
- **Take for MarketClue:** the forecast is an opt-in layer, and the default chart shows observed data only. MarketClue's projection should likewise sit in its own clearly labelled Estimate chart, never mixed into a sourced chart.

### 2.13 Glimpse (Google Trends add-on) — thin coverage

- The Chrome extension adds absolute search volume on top of Google Trends' 0–100 index, plus year-over-year change and trending searches by category ([Glimpse: search volume](https://meetglimpse.com/insights/google-trends-search-volume/)).
- A third-party write-up says the volume appears on hover over the curve ([ilovefreesoftware](https://ilovefreesoftware.com/?p=575072), third-party).
- A Glimpse page claims **87% forecast accuracy**; we found no method behind the number ([advantages/disadvantages](https://meetglimpse.com/google-trends/advantages-disadvantages/)).
- **Could not verify:** web app first screen, plans, sharing, accessibility.
- **Take for MarketClue:** always print the absolute value and the period it covers next to it.

**Avoid**
- Values that only appear on hover; keyboard, touch and screen-reader users can't reach them.
- Headline accuracy figures without a method.

### 2.14 GummySearch (Reddit founder research) — closed

**Status**
- GummySearch announced its shutdown in late 2025 ("The Final Chapter") after failing to reach a commercial licence for Reddit's Data API ([final chapter](https://gummysearch.com/final-chapter/)).
- New purchases stopped on 30 Nov 2025. Signups are closed, and **all user data is deleted on 1 Dec 2026** ([closing time](https://gummysearch.com/closing-time), [closed notice](https://gummysearch.com/docs/articles/gummysearch-is-now-closed-6533h), [pricing](https://gummysearch.com/pricing/)).
- The exact announcement date is **unverified**.

**What it did**
- You saved sets of subreddits as an "Audience" ([discover subreddits](https://gummysearch.com/how-to/discover-subreddits/)).
- Each audience opened into fixed theme buckets: **Solution Requests, Pain & Anger, Ideas, Money Talk, Opportunities, Advice Requests** ([customer discovery docs](https://gummysearch.com/docs/customer-discovery-using-reddit-y1p4c), [find problems to solve](https://gummysearch.com/how-to/find-problems-to-solve/)).
- AI summaries and "Patterns" grouped posts into common threads ([analyze patterns](https://gummysearch.com/demos/analyze-reddit-patterns/)).
- Keyword tracking delivered digests, with Slack and webhook delivery added over time ([release notes](https://gummysearch.com/releases/)).

**Evidence**
- "By the end of each claim, there'll be a source link to the actual Reddit post." Posts you had viewed got a check mark ([find problems to solve](https://gummysearch.com/how-to/find-problems-to-solve/)).

**Take for MarketClue**
- Plain-language buyer-theme buckets that open their member quotes. "Find your customers" should use founder words like "Pain", "Asking for a solution" and "Price talk", each opening its Sourced quotes.
- A "seen" check mark on cards you have opened.

**Avoid**
- Depending on one platform's API.
- Summaries that don't say how many posts sit behind them.

**Lesson:** capture dates and snapshots matter because source pages and threads disappear. MarketClue already stores both.

---

## 3. Page-by-page recommendation for v3

This section covers seven screens. All wireframes are for 1280 px; the 375 px notes are under each one. They use
only data the v3 API already returns unless marked **(needs API)**. Businesses, prices and quotes in the
wireframes are made up for illustration. The one exception is the Etsy listing-fee quote, which the current landing
page already uses.

### 3.0 Shared rules

- **One accent, and it's for interaction.** Rust `#B13C1C` is used for links, focus rings, the selected nav item and
  the "Sourced" kind. Primary buttons are ink (`#242522`) with white text. That way rust never has to compete
  between "click me" and "this is evidence".
- **Every statement carries its kind as text.** It shows as `Sourced`, `Assumption` or `Estimate`, with a small
  shape (● solid / ◆ outline / ≈) so it never depends on colour (WCAG 1.4.1).
- **Citations are numbered chips** `[1]` after the sentence. Pointer hover shows a preview card. Click, Enter or tap
  opens the full card in the side panel (desktop) or a bottom sheet (mobile). The chip's accessible name is
  "Source 1: etsy.com, Sourced".
- **Cards only for real objects**: a fact card, a chart, a tool, a run. Sections are separated by whitespace and a
  hairline, not by boxes.
- **Motion only on user action**: 120–180 ms opacity/translate, never on load. Under reduced motion, nothing moves.
- **Route changes**: update `document.title`, move focus to the page `<h1>` and announce it once via the existing
  `#live` region.

### 3.1 Landing (`#/`)

Show the product, not an abstract illustration. NotebookLM, Consensus and Elicit all make the quote itself the
citation (§2.3–2.5), and that is also MarketClue's strongest proof. So the hero shows one real sentence with its
quote card open, and keeps the slogan.

```
┌──────────────────────────────────────────────────────────────────────────────────────┐
│ ◐ MarketClue                               How it works   Sample report   [Sign in]  │  ← header landmark
├──────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   See the market differently.                    ┌──────────────────────────────────┐│
│                                                  │ Etsy charges $0.20 to publish a  ││
│   Market research for solo founders. Every       │ listing. ● Sourced  [1]          ││
│   line is an exact quote you can open, or is     │ ┌──────────────────────────────┐ ││
│   clearly labelled as a guess.                   │ │ [1] etsy.com · How to sell   │ ││
│                                                  │ │ "It costs $0.20 to publish a │ ││
│   [ G  Sign in with Google ]                     │ │  listing to the marketplace."│ ││
│   First report free · about 2 minutes            │ │ Captured 17 Oct 2026  Open ↗ │ ││
│   See a sample report →                          │ └──────────────────────────────┘ ││
│                                                  └──────────────────────────────────┘│
│                                                                                      │
│   Four tools, in the order founders need them                                        │
│   1 Discover            2 Compare             3 Prepare            4 Grow            │
│   Find your customers   Check competitors     Get ready to sell    Get your first    │
│   Who buys, and what    & prices              What do I need       customers         │
│   do they say?          Who sells this, and   before I sell?       Which channels,   │
│                         for how much?                              and what will it  │
│                                                                    cost?             │
│                                                                                      │
│   How every line is labelled                                                         │
│   ● Sourced     the exact quote was found on the page we captured (link + date)      │
│   ◆ Assumption  what we took as given; check it with real buyers                     │
│   ≈ Estimate    a number we worked out; the method is shown next to it               │
│   "Sourced" means the quote is really on that page — not that the page is right.     │
├──────────────────────────────────────────────────────────────────────────────────────┤
│ MarketClue · Built by Yuexizi Zhang          Accessibility   Reading & motion        │
└──────────────────────────────────────────────────────────────────────────────────────┘
```

- **375 px:** a single column. Order: slogan → subline → Sign in → sample card → tools as a vertical list with the
  stage number on the left → the labelling legend.
- **"See a sample report"** opens a public `#/shared/<token>` report so people can judge it before signing in.
  Elicit publishes public reports at `elicit.com/review/<id>` in the same way (§2.4). **(needs a fixed sample
  token)**
- Replace the current "VOL. 02 / lens / coordinates" editorial hero. It reads as a magazine, not a product. The
  owner called the current UI "too old".

### 3.2 App shell + sidebar history

This follows Linear's "inverted L": a quiet sidebar plus one consistent header row, with Share always in the same
place (§2.9). History combines Linear Agent's recency-grouped chat history with Perplexity's History page, which
has search and a type filter (§2.1). The Ctrl/⌘K search shortcut is the same one ChatGPT, Notion, Consensus and
Linear use.

```
┌───────────────────────┬──────────────────────────────────────────────────────────────┐
│ ◐ MarketClue      [⇤] │ Dog treat bakery · Check competitors & prices   [Share] [⋯] │  ← 56 px header
│                       ├──────────────────────────────────────────────────────────────┤
│ [ + New research     ]│                                                              │
│ [ ⌕ Search     Ctrl K]│                                                              │
│                       │                                                              │
│ ▤ My reports          │            main content                                      │
│ ❐ Fact library        │            reading width ≤ 720 px                            │
│ ⚇ Team                │            tables/library ≤ 1040 px                          │
│                       │                                                              │
│ RECENT                │                                                              │
│ Today                 │                                                              │
│ ◐ Dog treat bakery    │                                                              │
│   Running · Compare   │                                                              │
│ ○ Candle studio       │                                                              │
│   Draft · Discover    │                                                              │
│ This week             │                                                              │
│ ✓ Pet sitting app     │                                                              │
│   Done · Grow         │                                                              │
│ Earlier               │                                                              │
│ ✕ Yoga mats           │                                                              │
│   Failed · Compare    │                                                              │
│ Show all history →    │                                                              │
│ ───────────────────── │                                                              │
│ 1 free report left    │                                                              │
│ (YZ) Yuexizi Zhang  ▾ │  ← menu: Reading & motion, Help & accessibility, Sign out    │
└───────────────────────┴──────────────────────────────────────────────────────────────┘
   264 px, paper #F4F2EA          canvas #FBFAF5
```

- **Landmarks:** sidebar = `<nav aria-label="Main">`; Recent = a `<section>` with a heading and one `<ul>` per date
  group; main = `<main>`. Each history row is one link, 44 px tall minimum. Its accessible name reads "Dog treat
  bakery, Running, Check competitors & prices". `aria-current="page"` marks the open item.
- **Status chips:** Draft ○, Ready ◇, Running ◐, Done ✓, Failed ✕. There's always a word plus a shape. The
  running shape doesn't spin forever: it is static, and the header shows elapsed time.
- **Below 960 px**, the sidebar becomes a drawer: a modal `<dialog>` with a focus trap, Esc to close, and focus
  returned to the menu button. A sticky top bar holds ☰ menu, the page title and + New.
- **Search (Ctrl/⌘ K)** opens a dialog that searches history titles and the fact library together. It uses a
  modifier shortcut, so WCAG 2.1.4 doesn't apply. Don't add single-letter shortcuts. (Optional for v3; the
  Existing tab already covers search.)
- **Collapse ([⇤])** hides the sidebar to a 56 px icon rail. The state is kept in localStorage.

### 3.3 New research: tool picker + Quick/Smarter

Clarify, then confirm a plan before a long run. Elicit's agent asks clarifying questions, ChatGPT deep research
shows an editable plan, and Gamma's Plan mode offers tappable answers and then a plan to approve (§2.2, 2.4,
2.7). Put the effort choice at the input with plain trade-off copy and fixed names. Elicit uses a Fastest→Smartest
slider in the prompt box, Consensus a Deep toggle in the search bar, NotebookLM Fast vs Deep (§2.3–2.5).

**Step A — pick a tool (`#/new`, tab New):**

```
 New research
 ┌───────┐┌──────────┐
 │  New  ││ Existing │        role="tablist"; arrow keys move between tabs
 └───────┘└──────────┘
 Pick the question you want answered. You can change it before research starts.

 ┌ 1 Discover ──────────┐ ┌ 2 Compare ───────────┐ ┌ 3 Prepare ───────────┐ ┌ 4 Grow ──────────────┐
 │ Find your customers  │ │ Check competitors    │ │ Get ready to sell    │ │ Get your first       │
 │ Who buys, and what   │ │ & prices             │ │ What do I need       │ │ customers            │
 │ do they say?         │ │ Who sells this, and  │ │ before I sell?       │ │ Which channels, and  │
 │                      │ │ for how much?        │ │                      │ │ what will it cost?   │
 │ You get: buyer       │ │ You get: price table │ │ You get: checklist,  │ │ You get: plan, 4-week│
 │ themes + chart       │ │ + price chart        │ │ official sources 1st │ │ budget, projection   │
 └──────────────────────┘ └──────────────────────┘ └──────────────────────┘ └──────────────────────┘
```

Each tile is one link to `#/new/<feature>`. Its accessible name is "1 Discover: Find your customers", and the
description is set with `aria-describedby`. At 375 px the tiles stack as a list.

**Tab Existing:** a search field plus the same date-grouped list as the sidebar, with a status filter
(All / Drafts / Running / Done). Results announce their count: "6 results".

**Step B — chat with the research lead, then start:**

```
 Check competitors & prices · new conversation                                  [Change tool]
┌──────────────────────────────────────────────────────────┬──────────────────────────────┐
│ Research lead                                            │ Your brief                   │
│ Tell me what you sell, where you sell it, and any        │ Business   Grain-free dog    │
│ competitors you want to compare.                         │            treats            │
│                                                          │ Customer   Dog owners who    │
│                         I bake grain-free dog treats in ▸│            shop at markets   │
│                         Austin and sell at two markets.  │ Location   Austin, TX        │
│ Research lead                                            │ Stage      Selling offline   │
│ Do you also sell online, or only at markets? Any brands  │ Goal       Price an online   │
│ you see as competitors?                                  │            store             │
│                                                          │ Budget     —                 │
│                                                          │ ✓ Ready to research          │
├──────────────────────────────────────────────────────────┴──────────────────────────────┤
│ [ Message the research lead…                                                  ] [Send]  │
│                                                                                         │
│ Effort  ( • Quick   about 1.5 min · about $0.35 )  (   Smarter  about 3 min · $2–2.5 )  │
│         Smarter reads more pages with a stronger model. Owner account only for now.     │
│                                                              [ Start research → ]       │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

- **Effort control** = a native radio group in a `<fieldset><legend>Effort</legend>`, styled as a segmented
  control. Disabled Smarter keeps its hint visible as text, not in a tooltip. Choosing an option never starts a
  run (WCAG 3.2.2).
- **"Start research"** stays visible but disabled until `ready`. Next to it, a line explains why: "The research
  lead needs your location first." This avoids the dead disabled button.
- **The brief** sits in the right column on desktop. On mobile it is a collapsible "Your brief (5 of 6 filled)"
  above the composer. It is read-only; "Edit" puts "Change the location to …" into the composer.
- **Suggested replies:** when the research lead asks a question, show 2–3 tappable suggested answers under it
  (Gamma's pattern), plus free text. They are buttons that fill and send the composer. **(needs API: optional
  `suggestions` on the chat reply)**
- **Drafts persist:** the open `conv_id` and any unsent composer text go in localStorage, so a reload restores both
  (WCAG 3.3.7 Redundant Entry).
- **Free-run copy:** for a non-owner with 0 runs left, the Start button is replaced by a one-line explanation (from
  the 402 message) before they type, not after.

### 3.4 Live run view (`#/runs/<id>`, status queued/running)

Show progress honestly and let people leave. Perplexity shows the sources being read and early findings. Consensus
shows its plan with counts of papers retrieved and included. Elicit shows the current step, and both Elicit and
Consensus email you when a long run finishes (§2.1, 2.4, 2.5).

```
 Dog treat bakery · Check competitors & prices                      Quick · started 10:42
 ●━━━━━━━━━●━━━━━━━━━◐─────────○─────────○
 Plan       Research  Check     Write     Done
                      quotes
 Checking quotes · 1 min 10 s so far · Quick runs usually take about 1.5 min
 You can close this tab. The report will be in Recent when it is done.

 Research agents
 ┌────────────────────────────────────────────────────────────────────────────────┐
 │ ✓ Competitors & prices      Done      "Read 6 pages, kept 9 quotes"            │
 │ ◐ Sales channels & fees     Running   "Reading etsy.com/sell"                  │
 │ ○ Local rules               Queued                                             │
 └────────────────────────────────────────────────────────────────────────────────┘

 Pages read so far (11)                                         (needs API: run.pages)
   etsy.com — How to sell on Etsy
   petshop.example — Grain-free dog treats
   …
```

- **Map the seven backend stages** to five user-facing steps: planning → Plan; researching → Research; verifying →
  Check quotes; planning_marketing/checking/writing → Write; done → Done. Fewer steps means less churn in the
  stepper.
- **The stepper** is an `<ol>` with `aria-current="step"`. Each step's text says its state ("Research, done").
- **Polling stays at 3 s**, but `#live` announces only stage changes and completion, not every poll (WCAG 4.1.3
  without noise).
- **When done:** replace the view with the report in place, move focus to the report `<h1>`, and update the
  sidebar chip to Done. If the tab is hidden, change `document.title` to "✓ Report ready · MarketClue".
- **Failed:** show the error in plain words, keep the brief, and offer "Try again" (same conversation) plus "Copy
  error details".
- **Done email (optional):** when `SES_FROM` is configured, offer "Email me when it's ready" (unchecked by default)
  next to the "You can close this tab" line. **(needs API)**

### 3.5 Report: charts and source hover cards

Keep the classic v2 structure and add three things:
- Quote-first citations: hover shows the exact quote, click opens it (NotebookLM, Consensus, Elicit).
- Perplexity- and ChatGPT-style numbered chips.
- An evidence meter that holds back when evidence is thin, like the Consensus Meter (§2.5).

```
┌──────────────────────────────────────────────────────────────┬────────────────────────┐
│ Check competitors & prices · Quick · 4 Nov 2026              │ On this page           │
│ Grain-free dog treats in Austin                              │ · Brief at a glance    │
│ 18 fact cards · 15 sourced · 1 min 32 s      [Share] [Print] │ · Findings (5)         │
│                                                              │ · Prices               │
│ Brief at a glance                                            │ · Next steps           │
│ ┃ Local sellers price an 8 oz bag at $9–$14, about $4 above  │ · Evidence coverage    │
│ ┃ the biggest online brand. ● Sourced [1] [2]                │                        │
│                                                              │ Evidence               │
│ Findings                                                     │ ███████████████░░░     │
│ 1  Market sellers charge more than online brands             │ 15 of 18 quotes found  │
│    Two of three market sellers list 8 oz at $11+. [3] [4]    │ 11 pages read          │
│    ● Sourced                                                 │ 3 claims narrowed      │
│    ▸ Sources for finding 1 (2)                               │                        │
│          ┌───────────────────────────────────────────┐       │                        │
│     [3] ◄│ ● Sourced   barkery.example · Menu        │       │                        │
│          │ "Peanut butter crunch, 8 oz bag — $11"    │       │                        │
│          │ Captured 4 Nov 2026                       │       │                        │
│          │ Open page ↗        Open full card         │       │                        │
│          └───────────────────────────────────────────┘       │                        │
│                                                              │                        │
│ Price by seller (8 oz bag, USD)        ● Sourced [Show data] │                        │
│ Barkery         ███████████████ $11                          │                        │
│ Pawsome Bakes   ███████████████████ $14                      │                        │
│ Online brand    ██████████├──┤ $7–$9                         │                        │
│ Your band       ▨▨▨▨▨▨▨▨▨▨▨▨▨├─┤ $10–$12        ≈ Estimate   │                        │
│ Local sellers sit $3–$5 above the online brand.              │                        │
│ How we estimated your band: median local price ± $1. [5][6]  │                        │
└──────────────────────────────────────────────────────────────┴────────────────────────┘
```

**Source hover card (the key new component)**

| State | Behaviour |
|---|---|
| Pointer hover on `[n]` | Preview card after 300 ms; stays while the pointer is over the chip **or the card**; closes 200 ms after leaving both; Esc closes it (WCAG 1.4.13). |
| Keyboard focus on `[n]` | No auto-open (dozens of chips would be noisy). The accessible name carries the gist: "Source 3: barkery.example, Sourced". |
| Click / Enter / Space / tap | Opens the full card: side panel `<dialog>` on desktop, bottom sheet on mobile. Focus goes into it; Esc or Close returns focus to the chip. |
| Card content | Kind badge, source title + domain, the quote in serif italic, capture date, Stale badge if older than 90 days, "Open page ↗" (new tab, says so in its name), "Open in library", "Used in N reports". |
| Unverified card | Grey "Unverified — quote not found word for word on the page" line above the quote. Never rust. |

**Charts** (from `result.charts`; inline SVG, no library):

- `<figure>`: an `<h3>` title, the kind badge, the SVG (`role="img"`, `aria-labelledby` title + caption), a
  `<figcaption>` with the one-sentence takeaway, then a "How we estimated" line for estimates.
- Horizontal bars, because seller names are long and wrap well at 375 px. Every value is written at the bar end,
  so the chart needs no tooltip. Each row's label ends with its `[n]` chip(s).
- **Sourced** values are solid ink-on-canvas bars (`#242522`), or rust where one series is highlighted.
  **Estimates** are hatched sage-600 (`#5F6750`, 5.67:1) with an outline. **Ranges** are a light bar plus dark
  end ticks. That's three cues, not colour alone.
- **"Show data"** is a disclosure button (`aria-expanded`) that reveals a real `<table>` with a `<caption>`,
  `<th scope>`, and low/high columns for ranges.
- **Projection** (marketing plan): always a range ("12–25 sales in month one") with the arithmetic written out.
  Never a single number and never a line extending into the future. It lives in its own Estimate chart, never as
  a layer on a sourced chart (Exploding Topics keeps its forecast as a separate toggle, §2.12).
- **Missing values** are shown as a labelled "Not stated" row with no bar, never as a zero-length bar. If a chart
  has fewer than 2 values, show the sentence "Not enough data for a chart" instead (Similarweb's solid / dotted /
  "!" convention, §2.10).
- **Counts carry n.** Buyer-theme bars show the count ("Price is too high — 7 quotes") and never a percentage of
  a small total (SparkToro's small-numbers warning, §2.11). Clicking a bar opens its quotes, as GummySearch themes
  did (§2.14).
- **Confidence line** under every chart, in plain words: "Based on 9 quotes from 5 pages. Directional, not a
  survey."

**Price table cells** (competitor_scan): every price cell gets its own `[n]` chip. If a seller page doesn't state
a price, the cell says "Not stated" instead of being blank (Exa Websets' yes/no/unclear verdicts, §2.6).

**Evidence meter rule:** with fewer than 5 sourced quotes, replace the bar with the sentence "Too few quotes to
summarise — treat this report as a starting point."

**Mock-ups:** a "Show a mock-up" secondary button sits under the relevant section. Each image is captioned "AI
mock-up — not a real product photo" (visible text, also part of the alt text).

**At 375 px:** the "On this page" rail becomes a collapsible "Contents" disclosure under the title; the evidence
meter moves under the brief.

### 3.6 Fact library (`#/library`)

Elicit opens the supporting quotes for any table cell, and Exa Websets opens a row's criteria and sources in a
side panel (§2.4, 2.6). Do the same: a list of cards with the quote visible, and a side panel for the full card.

```
 Fact library                                                     ( Mine | Team )
 [ ⌕ Search claims, quotes and sources                    ]  Type ▾  Tool ▾  ☐ Stale only
 248 cards · 211 sourced                                                     Sort: Newest ▾
 ┌────────────────────────────────────────────────────────────────────────────────────┐
 │ Etsy charges $0.20 to publish a listing.                                ● Sourced  │
 │ "It costs $0.20 to publish a listing to the marketplace. A listing lasts…"         │
 │ etsy.com · Captured 17 Oct 2026 · Used in 3 reports · Added by YZ                  │
 ├────────────────────────────────────────────────────────────────────────────────────┤
 │ Rover sitters set their own rates.                          Unverified · Stale     │
 │ "Sitters set their own rates…"                                                     │
 │ rover.com · Captured 2 Jul 2026 · Used in 1 report                                 │
 └────────────────────────────────────────────────────────────────────────────────────┘
```

- **Mine | Team** is a two-option radio group, not tabs, because it filters the same list. "Added by" appears
  only in Team view.
- **Search** debounces at 250 ms and announces "12 cards" via `#live`. Empty state: "No cards match 'pricing'.
  Clear search" (a link that clears it).
- **The list is a `<ul>`;** each row's claim is a button that opens the side panel. The source link is a separate
  link, so there's no nested interactive content.
- **Stale** = a word badge plus "Captured over 90 days ago — prices and rules may have changed".

### 3.7 Team page (`#/team`) and join (`#/join/<token>`)

Several products share outputs but keep the working conversation private:
- NotebookLM keeps chat private inside a shared notebook (§2.3).
- Perplexity Projects members can't see each other's memory (§2.1).
- Consensus leaves threads out of shared collections (§2.5).

MarketClue has the same split (reports and cards shared, conversations private), so state it at the top of the
page. Keep members, invites and the invite form on one plain page.

```
 Team · Acme Treats                                                    You are the owner
 Shared with your team: finished reports and fact cards.
 Private to each person: conversations and research still running.

 Members (3)
 ┌──────────────────────────────────────────────────────────────────────────────────┐
 │ Yuexizi Zhang     y…@gmail.com      Owner     Joined 1 Nov 2026                  │
 │ Sam Lee           sam@acme.com      Member    Joined 2 Nov 2026         [Remove] │
 └──────────────────────────────────────────────────────────────────────────────────┘

 Invite someone
 Email address
 [ ana@acme.com                                   ]  [ Create invite ]
 They must sign in with Google using this address. Invites expire after 7 days.
 ✓ Invite link created — [Copy invite link]       (or: "✓ Invite emailed to ana@acme.com")

 Pending invites
 ana@acme.com      Expires in 6 days            [Copy link]  [Revoke]
```

- **Remove and Revoke** confirm in a small dialog that names the person: "Remove Sam Lee? They lose access to team
  reports and cards at once." Focus starts on Cancel.
- **Member view:** members list + "Leave team" (same confirmation pattern).
- **No team yet:** one sentence about what teams do, plus a "Team name" field and "Create team".
- **Join page:** "Yuexizi Zhang invited ana@acme.com to Acme Treats" → Sign in with Google → join. If the emails
  don't match, say which address the invite is for and offer "Sign in with a different Google account" (WCAG
  3.3.3).
- **Mine | Team** toggle on My reports, same as the library.

### 3.8 Token system

**Colours** — six core tokens plus three kind pairs. Ratios are WCAG 2.x contrast, computed for this document
(sRGB relative luminance).

| Token | Hex | Used for | Contrast |
|---|---|---|---|
| `--canvas` | `#FBFAF5` | main background, cards | — |
| `--paper` | `#F4F2EA` | sidebar, sunken areas, landing bands | — |
| `--ink` | `#242522` | text, primary button fill, sourced chart bars | 14.75 on canvas · 13.75 on paper · white on ink 15.41 |
| `--muted` | `#5B5E55` | secondary text, meta lines | 6.32 on canvas · 5.90 on paper |
| `--accent` (rust) | `#B13C1C` | links, focus ring, selected nav, Sourced | 5.69 on canvas · 5.30 on paper · 4.85 on `#ECE8DC` |
| `--border` | `#8C8676` | input borders, chip outlines, chart axes (needs 3:1) | 3.47 on canvas · 3.24 on paper |
| `--rule` | `#D9D4C7` | decorative dividers only (1.42 — **never** for a control boundary) | — |

| Kind badge | Background | Text | Contrast |
|---|---|---|---|
| ● Sourced | `#F3E3DC` | `#8E2F15` | 6.56 |
| ◆ Assumption | `#F8EBCF` | `#5E410B` | 7.95 |
| ≈ Estimate | `#E6E8DC` | `#434933` | 7.56 |

Notes:
- **Amber `#E3A43B` and sage `#7C8466` stay as brand colours but fail as text.** Amber is 2.08:1 on canvas; sage is
  3.76:1, which only clears large text and graphics. Use them only as fills behind dark text, or as decoration.
- **Estimate chart fill:** sage-600 `#5F6750` (5.67:1 on canvas) hatched. Never plain amber, which is 2.08:1 and
  fails the 3:1 graphics rule.
- **Focus ring:** 2 px solid `--accent` with a 2 px offset (5.69:1 against canvas). On the ink primary button, the
  offset puts the ring on canvas, so it stays visible.
- **Optional dark theme** (not in v3 scope, but cheap if tokens are used everywhere): canvas `#1C2028`, surface
  `#242833`, text `#ECEAE3` (13.56 / 12.23), muted `#A3A59C` (6.54 / 5.90), accent `#EE8F66` (6.81 / 6.14), border
  `#80848E` (4.36 / 3.93).

**Type** — the system UI stack (`system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif`) for speed and no
third-party font request. Keep Georgia/Cambria italic only for quotes, the brand's "this is evidence" signal.
Use `font-variant-numeric: tabular-nums` in tables and charts.

| Step | Size / line height | Weight | Use |
|---|---|---|---|
| display | 44 / 48 px (2.75 rem) | 650 | landing slogan only |
| h1 | 32 / 40 px (2 rem) | 650 | page and report title |
| h2 | 24 / 32 px (1.5 rem) | 600 | report sections, page sections |
| h3 | 20 / 28 px (1.25 rem) | 600 | finding titles, chart titles |
| lead | 18 / 28 px (1.125 rem) | 400 | brief at a glance, landing subline |
| body | 16 / 26 px (1 rem) | 400 | report text, chat, inputs (16 px stops iOS zoom) |
| quote | 17 / 26 px | 400 italic serif | quotes in cards and hover cards |
| small | 14 / 20 px (0.875 rem) | 400/500 | sidebar rows, meta lines, chips, table cells on mobile |

Nothing below 14 px. The "Larger text" preference scales the root size, so every step scales with it.

**Spacing and layout** — 4 px base on an 8 px rhythm: `--s1 4, --s2 8, --s3 12, --s4 16, --s5 24, --s6 32,
--s7 48, --s8 64`.

| Layout token | Value |
|---|---|
| Sidebar | 264 px; 56 px icon rail when collapsed; drawer below 960 px |
| Header row | 56 px |
| Page padding | 32 px desktop, 16 px at ≤ 720 px |
| Reading measure | max 720 px (~70 ch) for chat and report; 1040 px for library and tables |
| Targets | min 44 × 44 px for buttons, nav rows, chips outside running text |
| Radius | 6 px controls, 10 px cards, 14 px dialogs/sheets |
| Elevation | shadows only on floating layers (hover card, menu, dialog); everything else is flat with a 1 px border |
| Motion | 150 ms ease-out on open/close; 0 ms under reduced motion |

### 3.9 WCAG 2.2 AA checklist (MarketClue-specific)

★ = new in WCAG 2.2 ([W3C: What's new in WCAG 2.2](https://www.w3.org/WAI/standards-guidelines/wcag/new-in-22/);
full text at [w3.org/TR/WCAG22](https://www.w3.org/TR/WCAG22/)).

**Perceivable**
- [ ] **1.1.1 Non-text content:** tool icons and logo shapes are `aria-hidden` next to visible text. Each chart has
  a text alternative (title + caption) **and** a data table. Mock-up alt text = prompt kind + "AI mock-up — not a
  real product photo".
- [ ] **1.3.1 Info and relationships:** `header`/`nav`/`main`/`aside`/`footer` landmarks. Headings in order (one
  `h1` per route). Real `<table>` with `<th scope>`. Lists for history, findings and cards. `fieldset/legend` for
  Effort.
- [ ] **1.3.2 Meaningful sequence:** DOM order = reading order (report before the "On this page" rail).
- [ ] **1.3.5 Identify input purpose:** invite email has `type="email" autocomplete="email"`.
- [ ] **1.4.1 Use of colour:** kind and status shown with words + shape. Links in running text are underlined.
  Estimates are hatched as well as coloured.
- [ ] **1.4.3 Contrast (minimum):** body text ≥ 4.5:1; every pair is in the token table above.
- [ ] **1.4.4 Resize text / 1.4.10 Reflow:** works at 200 % zoom and 320 CSS px with no horizontal page scroll. Wide
  data tables scroll inside their own focusable region (`tabindex="0"`, labelled).
- [ ] **1.4.11 Non-text contrast:** input borders, chip outlines, focus ring and chart bars ≥ 3:1 (`--border`,
  `--accent`, `--ink`, `#5F6750`).
- [ ] **1.4.12 Text spacing:** no fixed heights on text containers; test with the "extra spacing" preference on.
- [ ] **1.4.13 Content on hover or focus:** source hover cards are dismissible (Esc), hoverable and persistent (see
  3.5).

**Operable**
- [ ] **2.1.1 Keyboard / 2.1.2 No trap:** every action works by keyboard. Drawer, dialogs and bottom sheet close
  with Esc and return focus.
- [ ] **2.1.4 Character key shortcuts:** only modifier shortcuts (Ctrl/⌘ K); no single-letter keys.
- [ ] **2.2.2 Pause, stop, hide:** no looping animation. The landing has no auto-playing motion; the running
  indicator is static.
- [ ] **2.4.1 Bypass blocks:** "Skip to content" link (exists) jumps past the sidebar.
- [ ] **2.4.2 Page titled:** `document.title` per route ("Dog treat bakery — Report · MarketClue").
- [ ] **2.4.3 Focus order:** focus moves to the `h1` on route change and into/out of dialogs predictably.
- [ ] **2.4.4 Link purpose:** "Open page ↗" names include the source title and "(opens in new tab)".
- [ ] **2.4.5 Multiple ways:** sidebar Recent + Existing tab search + My reports.
- [ ] **2.4.6 / 2.4.7 Headings, labels, focus visible:** 2 px rust ring with offset on every focusable element.
- [ ] ★ **2.4.11 Focus not obscured (minimum):** the sticky composer/start bar and mobile top bar never cover the
  focused element. Use `scroll-padding-top/bottom` equal to their heights.
- [ ] **2.5.3 Label in name:** the accessible name starts with the visible label ("Start research", "Copy invite
  link").
- [ ] ★ **2.5.7 Dragging movements:** no drag-only interaction (sidebar width is not drag-resizable, or it also has a
  button).
- [ ] ★ **2.5.8 Target size (minimum):** WCAG asks 24 × 24 px; MarketClue's own bar is 44 × 44. Inline `[n]` chips
  inside sentences are exempt as inline, but make them ≥ 24 px tall anyway.

**Understandable**
- [ ] **3.1.1 Language of page:** `lang="en"` (exists).
- [ ] **3.2.2 On input:** choosing a tool tile, Quick/Smarter or Mine/Team never starts a run or navigates
  unexpectedly.
- [ ] **3.2.3 / 3.2.4 Consistent navigation and identification:** the sidebar is identical on every app page, and
  the same icon + word for each status everywhere.
- [ ] ★ **3.2.6 Consistent help:** "Help & accessibility" is in the same place (account menu + footer) on every page.
- [ ] **3.3.1–3.3.3 Errors:** 402 / 403 / 429 / invite-mismatch errors say what happened and what to do, next to the
  control, with `role="alert"` only for blocking errors.
- [ ] ★ **3.3.7 Redundant entry:** the brief, unsent composer text and the chosen tool survive reloads and tool
  changes; never ask the founder to retype business details.
- [ ] ★ **3.3.8 Accessible authentication (minimum):** Google sign-in only; no CAPTCHA or puzzle; invites join by link
  without retyping a token.

**Robust**
- [ ] **4.1.2 Name, role, value:** tabs (`tablist`/`tab`/`tabpanel`), radio groups for Effort and Mine/Team,
  `aria-expanded` on Show data / Sources for finding N / Contents, `aria-current` in nav and stepper.
- [ ] **4.1.3 Status messages:** `#live` announces route changes, stage changes, run done, "Link copied" and search
  counts. It doesn't announce every 3 s poll.

**How to test:** axe-core in Playwright on every route at 1280 and 375 px; a keyboard-only pass; NVDA + Firefox
and VoiceOver + Safari on the report and run view; 200 % zoom; `prefers-reduced-motion: reduce`; Windows
`forced-colors: active` (not AA, but it catches icon-only states).

---

## 4. What to avoid

| # | Avoid | Seen where | Do this instead |
|---|---|---|---|
| 1 | **Renaming or re-hiding modes.** | Perplexity went from Deep Research → Research → the "+" menu → a Computer skill. ChatGPT renamed its thinking levels. Consensus turned Quick into "Paper Search" under Tools. Elicit uses two naming schemes for effort. | "Quick" and "Smarter", always next to Start research, with time and cost. Never move or rename them in v3. |
| 2 | **A citation that points to a page, not to the words.** Also "subtle" confidence flags. | A page-level citation forces the reader to hunt. Elicit's own write-up says it flags low confidence "subtly". | Show the quote in the hover card. Kind badges in words on every statement. Unverified cards say so in a full sentence. |
| 3 | **Statistics with no source.** | Gamma's own community forum has user complaints about generated statistics without sources. | No number without a kind. A number with no quote is an Estimate with a method, or it doesn't ship. |
| 4 | **False precision.** This means unexplained scores, accuracy claims without a method, and single-number forecasts. | SparkToro's docs describe the affinity scale as both 1–100 and 0–100. Glimpse claims "87% forecast accuracy" with no method we could find. Similarweb's own docs say small-site numbers have higher variance. | Ranges for every estimate. Round to what the method supports ("$10–$12", not "$11.37"). Write out the method. Show *n*. |
| 5 | **Information only on hover.** | A third-party write-up says Glimpse's search volume appears on hover over the curve. Hover-only content can't be reached by touch or keyboard and fails WCAG 1.4.13 if it can't be dismissed. | Data labels printed on the chart. "Show data" table. Hover cards always have a click/Enter equivalent. |
| 6 | **Custom menus and dialogs that break assistive tech.** | A user's JAWS report describes ChatGPT's model selector, + menu and source previews regressing after a Sep 2026 redesign. The NotebookLM VPAT lists a dialog that doesn't take focus, functions not reachable by keyboard, and content lost at 200% zoom. | Native `<dialog>`, radio groups, `<button>` and `<details>` first. Test with NVDA and VoiceOver. Test at 200% zoom and 320 px. |
| 7 | **Public-by-default sharing, and pseudo-permissions.** | Exa Websets on the free plan are public by default. NotebookLM's "Chat view" link hides sources, but Google says it is not a security boundary. | Reports are private until Share is pressed. The Share dialog says exactly what the link shows. Never offer a "limited" view that isn't enforced by the API. |
| 8 | **Throwing away work on cancel or close.** | Cancelling or minimising NotebookLM Deep Research discards what wasn't imported. | Runs continue when the tab is closed, and conversations and drafts survive reloads (localStorage `conv_id` + unsent text). |
| 9 | **Parallel tools that later have to be merged.** Also many doors into the same AI. | Elicit retired Find Papers, Extract Data and Chat with Papers into one Agent; the old sessions are view-only. Gamma runs a classic and an agent generator side by side. Notion AI opens from a face icon, the sidebar, a shortcut and a slash command. | The four tools are four entry templates into one conversation → run → report model, with one "New research" door. |
| 10 | **Depending on one platform's API.** | GummySearch closed after failing to get a commercial Reddit Data API licence; user data is deleted on 1 Dec 2026. | MarketClue reads public pages. Keep snapshots and capture dates, and show "Captured 17 Oct 2026" so readers know when a now-missing page said it. |
| 11 | **Single-letter shortcuts, and keyboard-only discovery.** | Linear relies heavily on single keys (`G` `I`, `J`/`K`). That's great for power users, but WCAG 2.1.4 needs an off switch, and a solo founder won't find them. | Only Ctrl/⌘K. Every action has a visible button. |
| 12 | **Credit and usage maths in the UI.** | Notion has two credit types (Standard and Select). Similarweb exports spend data credits. | Show one plain estimate in dollars and minutes. Non-owners see the free-run count, never a credit balance. |
| 13 | **A decorative, editorial landing.** | The current v2 landing uses "VOL. 02 — FOUNDER RESEARCH", an animated lens and coordinates. It reads like a magazine, and the owner called the UI "too old". | Slogan + one real quote card + four tools + the labelling legend (§3.1). |
| 14 | **Low-contrast "calm".** | Dimmed sidebars and light-grey meta text are common in this category. Linear dimmed its sidebar in 2026. MarketClue's `--rule` `#D9D4C7` is 1.42:1 and amber `#E3A43B` is 2.08:1. | Calm comes from spacing and fewer elements, not lighter text. Muted text stays ≥ 4.5:1 (`#5B5E55`); control borders and chart marks ≥ 3:1. |

---

## Appendix A. API additions this design assumes (all optional)

The wireframes work with the v3 API as specified. These small additions would make them better. Each is marked
**(needs API)** where it appears in §3.

| Where | Addition | Fallback without it |
|---|---|---|
| Landing "See a sample report" | A fixed public share token for one sample report | Hide the link |
| New research, step B | Optional `suggestions: [str]` (2–3 short answers) on the `POST /api/chat` reply | Free text only |
| Live run view | `run.pages: [{url, title, at}]` (pages read so far) | Use each agent's `note` |
| Live run view | Opt-in "Email me when it's ready" via SES (`SES_FROM` already exists for invites) | "You can close this tab" + Recent |
| Report, price table | `table.checked` (sellers looked at) beside rows shown | Omit the "11 checked, 6 shown" line |

## Appendix B. Sources not verified

Each "unverified" item is marked where it appears in §2. These are the larger gaps:
- **Exa** search UI and Websets history: not covered.
- **Exploding Topics and Glimpse:** first screen, saving, sharing and accessibility were not covered.
- **Perplexity Pages:** whether "Create page" is back after being "temporarily retired".
- **ChatGPT:** the contents of the VPAT on its trust portal.
- **ChatGPT:** whether the sidebar still groups history by date.
- **Linear:** focus-ring styling, reduced-motion support and official sidebar width.

To close these gaps, allow the vendor domains in the session's network settings and re-run the research with
direct page reads.
