---
project: KaunterAI
artifact: "Product soul and visual direction"
audience:
  - "Product designers"
  - "Frontend engineers"
  - "Coding agents changing any user-facing surface"
purpose: "Preserve the product's focus, taste, and anti-generic interface rules across rebuilds."
status: "Canonical design contract with a verified local synthetic implementation."
created_at: "2026-07-14"
last_updated: "2026-07-14"
last_verified: "2026-07-14"
verification_method:
  - "Complete local verification gate"
  - "Browser matrix at 1440px, 390px, and 320px"
  - "Automated accessibility, overflow, touch-target, and route-delivery checks"
  - "Cross-document consistency review"
  - "Independent cold-read design and causal audit"
source_basis:
  - "Chatwoot dashboard hierarchy: https://chatwoot.help/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics"
  - "Cursor review surfaces: https://cursor.com/docs/cursor-review/pr-page"
  - "VS Code workbench and Markdown diff behavior: https://code.visualstudio.com/docs/editing/userinterface and https://code.visualstudio.com/docs/languages/markdown"
  - "Braintrust evaluation concepts: https://www.braintrust.dev/docs/evaluate"
  - "Langfuse experiment concepts: https://langfuse.com/docs/evaluation/core-concepts"
  - "Perplexity source transparency: https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work"
  - "The operator's hand-drawn Dream references"
  - "PROJECT.md behavior, safety, and spatial contract"
relationship_to_project: "SOUL.md guides taste and attention. PROJECT.md governs observable behavior, data, safety, page geometry, and acceptance."
stack_policy: "No framework, component library, editor, table, chart, or storage choice is required."
theme: "Light mode only"
---

# KaunterAI Soul

KaunterAI is one calm workbench for human-supervised agent operations.

It should feel focused enough that a staff member always knows what deserves attention, dense
enough that real work stays visible, and honest enough that synthetic behavior never looks like a
production claim.

## 1. North star

> Show the artifact, the evidence, and the next human decision in one frame.

The artifact changes by route:

- Chat Control: a patient conversation.
- Dream: a playbook file and its proposed line changes.
- Evals: an evaluation case and its grading evidence.

The interface exists to help the human inspect and decide. It is not a home page, management
dashboard, analytics portal, or decorative shell around modal workflows.

## 2. Product posture

| Tension | KaunterAI means | It does not mean |
|---|---|---|
| Minimal but complete | Only the surfaces needed to close the full human-supervision loop | Remove evidence, recovery, or edge cases to make a screen look empty |
| Dense but readable | Keep the working artifact and nearby context visible together | Shrink text, clip timestamps, or hide full content with no recovery |
| Synthetic but believable | Every control works on bounded synthetic case data; simulated and live judge evidence are labeled | Pretend a patient, clinic, nurse, or emergency service was contacted |
| Calm but not bland | Quiet surfaces, sharp hierarchy, rare semantic color | Generic gray cards with no task-specific shape |
| Familiar but not copied | Reuse proven workbench patterns from strong products | Clone another product's brand, dark theme, or irrelevant controls |
| Automated but human-owned | The agent proposes and tests; a person promotes or rejects | Treat a score or generated correction as approved behavior |
| Complete controls only | Every visible control completes one defined flow | Dead, placeholder, or decorative controls that look finished but do nothing |
| Complete but not broad | Every visible path finishes and every failure explains itself | Add settings, profiles, notifications, dashboards, or extra routes |

Completeness is depth, not surface area. A feature is complete when its success, empty, loading,
cancel, stale, invalid, and destructive paths make sense. Adding another page does not make it
more complete.

## 3. What KaunterAI is

- A task-native clinic front-desk inbox.
- A file-centered human review workbench.
- A case-centered evaluation lab.
- A closed synthetic loop from conversation to evidence to proposed playbook change.
- A demonstration of how human judgment can remain explicit inside an agent workflow.

## 4. What KaunterAI refuses to become

- A generic admin dashboard with a sidebar and card grid.
- A full clinic ERP.
- A clone of Chatwoot, Cursor, VS Code, Braintrust, Langfuse, or any other reference.
- A marketing site with hero copy, feature cards, testimonials, or oversized empty space.
- A full IDE with terminals, extensions, source control, or unrelated file types.
- An analytics suite where aggregate charts replace case-level evidence.
- A chat product where the patient record is hidden behind repeated navigation.
- A model lab that leaks the expected human answer into generation.
- An autonomous deployment system that skips human playbook approval.
- A fake interface with dead icons, placeholder buttons, or decorative data.

There are exactly three top-level routes. Supporting work belongs in a pane, drawer, dialog,
dock, or overflow menu.

## 5. Reference lineage

References teach information hierarchy. They do not dictate the brand.

| Reference | KaunterAI copies conceptually | KaunterAI deliberately rejects | Why it fits KaunterAI |
|---|---|---|---|
| [Chatwoot dashboard](https://chatwoot.help/hc/user-guide/articles/1677231493-lesson-2-dashboard-basics) | A scannable queue, selected conversation, reply composer, and customer context visible in one working frame | Its global navigation rail, omnichannel administration, campaigns, reports, and broad contact-management surface | Clinic staff need the thread and patient context at decision time, but KaunterAI has only three routes and does not need a support-suite shell |
| [Cursor review](https://cursor.com/docs/cursor-review/pr-page) | A synchronized changed-file list, focused artifact, review comments, and per-change decision loop | Agent-management chrome, pull-request metadata, merge controls, source control, and session-level bulk approval | Dream needs a human to inspect evidence and decide one proposed text change without leaving the file |
| [VS Code workbench](https://code.visualstudio.com/docs/editing/userinterface) and [Markdown diffs](https://code.visualstudio.com/docs/languages/markdown) | A narrow file explorer, dominant editor, line focus, visible old/new treatment, and a lower panel for test output | Activity bar, terminal, extensions, debug tooling, movable layout settings, and dark IDE styling | Dream is file-centered and test-backed, but its only job is playbook review, so the workbench grammar transfers without full IDE complexity |
| [Braintrust evaluations](https://www.braintrust.dev/docs/evaluate) | Dataset cases with inputs, expected outputs, generated outputs, scorers, and immutable run evidence | Playground sprawl, multi-model comparison controls, production observability, cost and latency dashboards, and CI surfaces | The Evaluation Lab must keep raw case evidence primary while still showing whether a candidate changed across runs |
| [Langfuse evaluation concepts](https://langfuse.com/docs/evaluation/core-concepts) | A clear separation between datasets, experiment runs, item-level outputs, and scores | Trace trees, spans, prompt management, production telemetry, and generic observability navigation | KaunterAI needs reproducible synthetic run history and item-level rationale, not an observability platform |
| [Perplexity source transparency](https://www.perplexity.ai/help-center/en/articles/10352895-how-does-perplexity-work) | Put evidence next to the claim it supports, keep the reading surface calm, and make deeper sources available without blocking the main answer | Consumer search, discovery feeds, focus modes, source carousels, marketing chrome, and Perplexity branding | Dream corrections and Eval grades are only trustworthy when a reviewer can read the proposal and its evidence in the same visual beat |
| Hand-drawn Dream frame | Left files, center editor, right corrections, independent scroll, and a visible Test Changes action | A dead Dream Cycle button with no defined behavior | It makes the saved playbook the dominant artifact and keeps every human decision next to the proposed change |

The Dream reference includes a Dream Cycle action. KaunterAI does not expose that control while
candidate iteration belongs to Evals. A control does not earn space until it has one clear,
testable effect.

The evaluation reference's score distribution does not transfer. KaunterAI stores ordered suite
snapshots, so its aggregate visual is a pass-rate history chart. It does not invent distribution,
variance, or per-metric regression data that the product model does not contain.

## 6. One workbench grammar

All routes share a thin top shell and a task-specific workbench.

```text
+------------------------------------------------------------------------+
| KaunterAI | Chat Control | Dream | Evals       Synthetic Demo | Reset |
+------------------------------------------------------------------------+
| route toolbar: title, current context, direct actions                  |
+------------------------------------------------------------------------+
|                                                                        |
| task-specific working artifact                                        |
|                                                                        |
| nearby evidence and contextual actions                                 |
|                                                                        |
+------------------------------------------------------------------------+
```

The shell is not the product. It stays small so the route can own the frame.

### Shared grammar

- One route title. No subtitle block above the toolbar.
- One dominant working artifact.
- One primary action for the current task.
- Secondary actions remain near the artifact they affect.
- Maintenance actions move to overflow before task actions do.
- Hairline separators define regions. Cards are not the default layout primitive.
- Each pane owns its scroll. The document does not become one long dashboard page.
- Empty states use short inline copy, not illustrations.
- Destructive actions name their effect before confirmation.
- Toasts confirm short-lived results. They do not carry important causal warnings.

## 7. Visual temperament

### 7.1 Color

The palette is light, neutral, and clinical without looking medical-themed. The rules below are
the source of truth for color use.

| Token role | Color | Use |
|---|---|---|
| Paper | `#FCFCFA` | App and editor background |
| Raised surface | `#FFFFFF` | Menus, dialogs, drawers, composer |
| Quiet surface | `#F3F5F2` | Hover, grouped headers, inactive controls |
| Selected surface | `#DDEEE9` | Selected queue row, file, case, or tab |
| Hairline | `#D8DDD8` | Pane, row, table, and toolbar separators |
| Strong border | `#AEB8B1` | Focused input and active segmented control |
| Ink | `#17211E` | Primary text |
| Muted ink | `#5C6963` | Metadata, timestamps, helper copy |
| Petrol accent | `#0B6B5F` | Primary action, focus ring, active edge |
| Petrol pressed | `#084F47` | Active primary action |
| Risk | `#9C3531` on `#FBE9E7` | Destructive and emergency state |
| Warning | `#7A5111` on `#FFF2CF` | Blocked, pending, stale, unsaved |
| Success | `#2D6848` on `#E7F3EA` | Approved, passed, saved |
| Information | `#285D85` on `#E8F1F7` | Synthetic and transcript-only notices |
| Diff remove | `#8B302D` on `#F8E6E3` | Exact old text and removed-line marker |
| Diff add | `#265F40` on `#E4F1E8` | Exact proposed or approved new text |

Rules:

- Color communicates selection, state, or risk. It is not decoration.
- Purple from eval references does not transfer into the KaunterAI brand.
- Red and green always include text. Color alone never carries pass or fail.
- The petrol accent appears on one primary action or one selected edge at a time.
- Emergency red never fills a large panel. It marks the group, action, and persistent warning.
- Every declared foreground and background pair must pass WCAG AA before implementation is
  accepted.
- No gradients.
- No dark theme.
- No large tinted dashboard panels.

### 7.2 Type and density

- Primary interface face: Instrument Sans, packaged with the application.
- Data and editor face: IBM Plex Mono, packaged with the application.
- Base interface text: 13px.
- Route titles and pane headings: 14px at 600 weight.
- Dense row labels and controls: 12px to 13px.
- Metadata and timestamps: 11px to 12px.
- Paths, line changes, and model output may use monospace.
- Patient messages and explanations stay in a readable sans-serif face.
- No marketing-size headings.
- Numbers use stable-width digits when alignment matters.
- Body line height is 1.45. Dense metadata line height is 1.25. Editor line height is 22px.

The interface should show more useful rows before it increases font size or card padding.
Density never overrides the 44 by 44px mobile interaction target.

### 7.3 Spacing and shape

- Base spacing unit: 4px.
- Common gaps: 8px, 12px, and 16px.
- Region padding stays compact.
- Small radius: 4px.
- Standard control radius: 8px.
- Large dialog radius: 10px.
- Pills are reserved for compact status or segmented choices.
- Full panes and table rows stay square-edged.
- Shadows are reserved for overlays. The workbench uses borders.

### 7.4 Motion

- Motion explains state change. It does not entertain.
- Hover and menu transitions stay under 200ms.
- Charts do not animate.
- Pane changes are immediate.
- Progress indicators show actual synthetic steps.
- Reduced-motion preferences remove non-essential transition.

### 7.5 Selection, messages, and actions

Selection is a location signal, not decoration:

- Selected rows use the selected surface plus a 2px petrol leading edge.
- Hover uses the quiet surface only. It never adds elevation.
- Keyboard focus uses a 2px petrol ring with a 2px paper offset.
- Unread or urgent state uses weight and a labeled marker, never an unexplained dot.

Conversation messages are compact operational chat bubbles:

- Patient messages align left and use a readable 68ch maximum.
- Staff and synthetic-agent replies align right under explicit role labels.
- Patient, staff, and synthetic-agent colors stay subtle; side, icon, and label carry the role.
- Internal notes use the warning surface and an "Internal note" label.
- System audit rows stay centered with muted ink, a dashed border, and a lock icon.
- English translations sit directly below non-English source text with an "English translation" label.

Action emphasis:

- One filled petrol action exists in the current decision region.
- Secondary actions use a bordered or text treatment.
- Maintenance actions use text or More.
- Destructive actions use risk text and a border. They do not become a filled toolbar action.
- Cancel replaces or sits immediately beside the running action. It never moves to a distant menu.

## 8. Attention and action hierarchy

The user should never scan the whole page to find the next action. Each route has one primary
decision:

| Route | Primary decision | What stays quieter |
|---|---|---|
| Chat Control | Respond to or act on the selected patient conversation | Search, Schedule, and simulation utilities |
| Dream | Approve, reject, or focus the selected file's pending correction | File maintenance |
| Evals, no case selected | Run the suite or open one raw case | Dataset and criterion maintenance |
| Evals, case selected | Inspect or run that case | Run Suite and aggregate context |

A maintenance action never receives stronger emphasis than the task decision. Exact action order
and placement live in `PROJECT.md` sections 7.2, 8.12, and 9.2.

## 9. Page signatures

These are identity maps. Exact geometry and behavior live in `PROJECT.md`.

### 9.1 Chat Control

```text
+------------------+--------------------------------+------------------+
| grouped queue    | selected conversation          | patient context  |
| urgency first    | thread header                  | details          |
| full timestamps  | messages scroll                | triage           |
| compact metadata | composer stays reachable       | booking + links  |
+------------------+--------------------------------+------------------+
```

The queue is a list, not a table or card gallery. The conversation is the page's center of
gravity. Patient context stays adjacent because staff decisions depend on it.

Schedule is a view inside Chat Control, not a fourth route:

```text
+--------------------+--------------------------------------------------+
| seven day index    | selected day                                     |
| date + count       | time | patient | provider | booking state        |
| compact list       | booking rows, not calendar cards                 |
+--------------------+--------------------------------------------------+
```

It uses the same row density, patient names, status text, and selected edge as the queue. It is
not a month calendar, KPI panel, or color-block planning dashboard.

### 9.2 Dream

```text
+--------------+--------------------------------------+------------------+
| playbook     | editable file                        | changes          |
| files        | line numbers and highlights          | old -> new       |
|              |                                      | evidence         |
|              | test dock opens below editor         | decide in place  |
+--------------+--------------------------------------+------------------+
```

Dream is an editor with a review rail. It is not a document dashboard. Pending corrections stay
expanded. Decided corrections compress. Test results open as a dock, not another route or tab.

### 9.3 Evals

```text
+---------------------------------------------------+--------------------+
| raw case table                                    | compact scores     |
| metadata | input | expected | actual              | suite history      |
| criteria | grade | actions                        | selected context   |
| desktop: filters, then a complete case row        | supporting only    |
+---------------------------------------------------+--------------------+
```

Evals is a lab bench, not an analytics homepage. Aggregate scores support the rows. They never
replace them. The first viewport below the toolbar always shows at least one complete case row or
case card. At middle widths, the summary and chart compress above the cases. On mobile, the compact
summary stays visible and History opens the chart in a supporting drawer while cases become a
single-column card list.

## 10. Interaction philosophy

### 10.1 Actions live with their object

- Reply lives with the conversation composer.
- Booking decisions live with the booking.
- Correction decisions live on the correction.
- Run Case lives on the case.
- Dataset maintenance lives near the dataset selector.

Do not place every action in one global toolbar.

### 10.2 Progressive disclosure

- Wide screens keep frequently compared context side by side.
- Narrow screens show one pane at a time.
- Drawers reveal detail without changing the route.
- Dialogs are for creation, editing, confirmation, or bounded configuration.
- Overflow menus hold secondary maintenance actions, never the main task action.

### 10.3 Full text remains recoverable

Compact rows may truncate. The user can always recover the complete value through the selected
thread, editor, drawer, or expanded card. A tooltip or `title` attribute alone does not satisfy
recovery.

### 10.4 Feedback matches consequence

- Short success: polite status or toast.
- Running work: inline progress in the owning region.
- Validation failure: next to the invalid field.
- Stale or blocked decision: persistent message next to the blocked action.
- Destructive effect: confirmation before mutation.

### 10.5 State chrome

- Empty: one or two lines of actionable copy in the owning region. No illustration or stale
  selection remains.
- Loading: a labeled inline status in the owning pane. No full-page skeleton or global progress bar.
- Running: progress, completed count, and Cancel replace the idle action in place.
- Blocked: the disabled action and its reason remain adjacent.
- Invalid: field-local error copy stays beside the value; stored state remains unchanged.
- Error: the failed action, cause, and recovery stay in the owning pane. A toast may repeat but
  never replace causal copy.
- Cancel: no durable mutation; the pane returns to the last committed state.
- Stale: a warning strip spans the affected row, card, or correction and names what must be
  refreshed or rerun.
- Destructive: the confirmation title names the object and the body lists each removed dependent.

## 11. Causal honesty

KaunterAI must feel real without making false claims.

Synthetic behavior must look usable without looking deployed. Important causal warnings live in
the relevant dialog, drawer, or dock. They do not disappear as toasts.

Required behavior, wording, and placement live in `PROJECT.md` sections 3, 7.11, 8.9, 8.12, and
9.8.

## 12. Responsive philosophy

Responsive design changes the interaction model. It does not squeeze the desktop layout.

- Shell: text labels may collapse to icons; navigation and Reset remain reachable.
- Synthetic Demo remains visible as a compact Demo label at every width.
- Chat Control: three columns -> two columns plus drawer -> one-pane sequence.
- Dream: three columns -> Files, Editor, and Changes tabs with one rendered pane.
- Evals: table and summary rail -> compact summary, filters, case cards, and chart in History.
- Every mobile target is at least 44 by 44 CSS pixels.
- Names may ellipsize before timestamps.
- Fixed-width content must use shrinkable tracks.
- A drawer begins below the shell when shell navigation must remain usable.
- Inactive panes are removed from rendering and the accessibility tree, not merely hidden visually.

The narrowest required width is 320px. Passing document-level overflow checks is not enough.
Critical child bounds must also fit.

## 13. Anti-generic rules

| Generic substitution | Why it fails | Required KaunterAI shape |
|---|---|---|
| Sidebar app navigation | Makes the shell dominate three simple routes | Thin top shell |
| Welcome or overview dashboard | Delays the actual task | Open directly on the workbench |
| Hero KPI cards | Turns evidence into decoration | Slim score summary beside or above raw cases |
| Equal card grid | Erases task hierarchy | Lists, panes, rows, and one selected artifact |
| Modal as primary workflow | Hides context needed for judgment | Adjacent pane or non-modal drawer |
| Dark IDE clone | Copies a reference instead of the product | Light workbench with functional diff color |
| Large rounded cards everywhere | Wastes space and makes every object equally important | Hairline regions and compact rows |
| Icon-only state | Hides meaning and accessibility | Text plus number or state |
| Hamburger on wide screens | Hides direct task actions | Ordered toolbar with maintenance overflow only |
| Generic data grid features | Adds resize, pin, export, and settings with no user need | The named evaluation columns and limited sorting |
| Folder tree in Dream | Adds hierarchy the product does not use | Flat playbook file list |
| Replay route or tab | Splits one review task into another destination | Bottom test dock inside Dream |
| Detached Sources modal | Makes evidence a second task | Evidence directly below the claim, correction, or grade it supports |
| Multi-panel mobile squeeze | Preserves geometry but destroys usability | One-pane choreography or cards |
| Illustration-heavy empty state | Adds noise to an operational tool | One or two lines of actionable copy |
| Dead reference control | Looks complete but has no causal effect | Omit it until behavior is defined |

## 14. Screenshot review gate

Review `/`, `/dream`, and `/eval` at 1440 by 900, 390 by 844, and 320 by 568 CSS pixels.

The normative release gate is `PROJECT.md` section 14.7. The questions below are the design
review lens.

Fail the design when any answer is no:

1. Is the working artifact visible without scrolling past a title or KPI wall?
2. Can the user name the primary action within two seconds?
3. Does the route still look like its own task, not the same dashboard template with different
   cards?
4. Is every aggregate number connected to raw evidence?
5. Are timestamps, statuses, and causal labels readable?
6. Can truncated content be recovered?
7. Does each pane have one clear scroll owner?
8. Are maintenance actions quieter than task actions?
9. Does mobile change panes instead of shrinking desktop columns?
10. Are synthetic, sandbox, transcript-only, and Test Changes versus Eval-score boundaries visible
    at the moment they matter?
11. Are there zero dead controls?
12. Would removing any visible region make the primary workflow incomplete?

## 15. Agent preflight

Before changing a page:

- [ ] Read this file and the matching route contract in `PROJECT.md`.
- [ ] Name the route's one working artifact.
- [ ] Draw the desktop and mobile frame before writing components.
- [ ] Assign one scroll owner to every pane.
- [ ] Rank primary, secondary, contextual, and maintenance actions.
- [ ] Map every visible control to a working flow; wire or remove anything else.
- [ ] Preserve the three-route rule.
- [ ] Check the anti-generic table.
- [ ] Label synthetic behavior at the decision point.
- [ ] Define empty, loading, running, blocked, invalid, error, cancel, stale, and destructive states.
- [ ] Verify 1440 by 900, 390 by 844, and 320 by 568 CSS pixels.
- [ ] Compare the screenshot with the page signature, not with a generic component gallery.

## 16. Relationship to `PROJECT.md`

Canonical read order and contract hierarchy: `PROJECT.md` section "Read order and contract
hierarchy". Before designing a surface, read this file's sections 1 through 5 and 13, then the
matching `PROJECT.md` route contract.

When visual judgment conflicts with observable behavior, the contract hierarchy in `PROJECT.md`
wins. If a visual choice changes behavior or a screenshot acceptance test, record the exact
requirement there. If it explains why the product should feel a certain way, keep it here.

## 17. Flexible choices

These can change without changing the soul:

- the frontend framework;
- the state or persistence mechanism;
- the editor, table, chart, dialog, icon, or routing implementation;
- the font delivery mechanism; changing Instrument Sans or IBM Plex Mono requires design approval;
- exact column pixels at intermediate desktop widths;
- microcopy that preserves the same causal meaning;
- icons that preserve accessible names;
- fixture names and values when the same flows remain testable.

The implementation is replaceable. The attention model is not.
