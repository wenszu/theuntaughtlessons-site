# Assessments and Grocery List Reference
Last updated: 2026-06-02

This file documents the current assessment content, answer keys, and scoring methodology used by The Untaught Lessons website. It is intended as a shareable reference for collaborators reviewing the assessment design.

Source files used:
- `data/sort-bucket.json` - public Find your level sort-and-bucket assessment
- `data/tsa/sort-bucket.json` - member diagnostic/checkpoint sort-and-bucket assessment
- `data/tsa/spot-the-problem.json` - member spot-the-problem assessment
- `data/tsa/speak-concisely.json` - member speak-concisely assessment prompts
- `data/tsa/act-confidently.json` - placeholder assessment
- `data/practice/grocery-list.json` - Phase 1 grocery list practice exercise
- `apps/tsa-sort-bucket/index.html`, `apps/tsa-spot-the-problem/index.html`, and `apps/tsa-speak/index.html` - scoring logic

## Assessment Inventory
- Public Find your level: Sort & Bucket using `data/sort-bucket.json`.
- Member Diagnostic / Checkpoint: Sort & Bucket, Spot the problem, Speak concisely, and the Act confidently placeholder.
- Phase 1 practice: Grocery list sorting exercise. This is a practice exercise, not a scored assessment.

## Scoring Methodology
### Sort & Bucket
Total score: 20 points.

- Bucket labels: 6 points total, 2 points per correct bucket label. The scorer accepts exact/near labels through each set's label-equivalent list. The current fuzzy match checks whether the participant label and accepted equivalent share the same first-word concept.
- Item placement: 14 points total. Items receive credit when placed in the canonical correct bucket. Some items are marked as dual-bucket accepted and can count in either approved bucket.
- Placement score by number of misplaced items: 0 misplaced = 14; 1 = 11; 2 = 8; 3 = 6; more than 3 = 6 minus 1.5 points per additional misplaced item, floored at 0.
- Final score: bucket label score plus placement score, rounded to one decimal place.
- Interpretation: 18+ = Strong; 13-17.9 = Solid; 8-12.9 = Developing; below 8 = Early stage.

### Spot the Problem
Total score: 20 points.

- Part A, Find the overlaps: 10 points. Each problem contains overlapping item pairs. The learner gets credit for moving both items in an overlap pair into the left-side removal area. Points are divided evenly across the selected overlap pairs.
- Part B, Fix the gaps: 10 points. The learner places missing items into the correct bucket. Points are divided evenly across the selected answer items.
- Final score: Part A plus Part B, rounded to one decimal place.
- Interpretation: 18+ = Sharp; 12-17.9 = Good eye; 4-11.9 = Getting there; below 4 = Early stage.

### Speak Concisely
Total score: 30 points.

- Message coverage: 12 points. The scorer checks whether the learner covers the three key messages for the selected prompt.
- Delivery quality: 9 points. The scorer evaluates controlled pacing, vocal clarity, and commanding presence.
- Conciseness / compression: 9 points. Diagnostic mode uses concise execution. Checkpoint mode uses the compression score from the second attempt.
- AI scoring: When configured, the app sends the transcript to a scorer using the C3 rubric criteria C1, C4, C5, C6, C7, and C8, plus message-hit scoring and feedback.
- Local fallback scoring: If the external scorer is unavailable, the app uses keyword matching against the three key messages and timing heuristics.
- Timing penalties: Very short responses reduce message coverage. Overlong responses reduce delivery or conciseness. Checkpoint mode separately evaluates the first full attempt and the compressed second attempt.
- Interpretation: 27+ = Exceptional; 21-26.9 = Strong; 13-20.9 = Developing; below 13 = Early stage.

### Act Confidently
Current status: placeholder only. The data file says this assessment is coming soon, so there is no live scoring methodology yet.

### Grocery List Practice
Current status: practice exercise only. No numeric score is currently computed. The exercise is designed for self-practice around MECE grouping and the rule of three. The reference answer is the ideal bucket assignment in the JSON data.

## Grocery List Practice Exercise
- ID: grocery_list_001
- Title: Grocery list
- Difficulty: beginner
- Phase: think-clearly
- Prompt: Sort this list into clean MECE buckets.
- Timer: 5 minutes
- Generation settings: 24-30 items, with at least 3 items per bucket.
- Reflection prompts: What made your categories clean or unclear? / Where did you have overlap?

Ideal buckets and item bank:
- Fresh / cold food: Carrots; Frozen meatballs; Cheese; Chicken; Potatoes; Milk; Sausages; Butter; Beef; Bell peppers; Lettuce; Spinach; Cream; Grapes; Garlic; Ice cream; Onions
- Pantry items: Pasta; Canned tomatoes; Paprika; Rice; Sugar; Salt; Bottled olives; Olive oil
- Non-food supplies: Bathroom tissue; Candles; Charcoal; Kitchen towels; Paper plates

Keywords by bucket:
- Fresh / cold food: fresh, cold, fridge, frozen, produce, meat, dairy, perishable, refrigerated
- Pantry items: pantry, dry, shelf, canned, staples, grains, seasoning, oil, cupboard
- Non-food supplies: supplies, non-food, household, party, tools, paper, cleaning, cooking

## Public Find your level: Sort & Bucket Sets
### 1. Meeting agenda from hell
- ID: sort_bucket_001
- Difficulty: beginner
- Scenario: You are five minutes away from a leadership team meeting. Someone has sent you the agenda - 12 items, no structure, no priorities. Before everyone walks into the room, you need to sort them: what actually needs a decision today, what is just an update, and what should never have been on the agenda in the first place.
- Prompt: Sort the 12 agenda items into three clean buckets.
- Correct bucket labels: Decisions needed, Updates only, Parking lot
- Label word bank: Decisions needed, Updates only, Parking lot, Action items, Discussion topics, Information share, Open issues, Follow-ups, Announcements, Next steps
- Dual-bucket accepted items: Debate over office layout

Answer key:
- Decisions needed: Q3 budget approval vote; Decision on vendor contract; Product launch go/no-go; Debate over office layout
- Updates only: Project status from team leads; New org chart announcement; Policy change effective next month; Action items from last week
- Parking lot: Someone's vacation dates; Team birthday celebration; Uploading team photos from last offsite; Request for IT equipment

Accepted label equivalents:
- Decisions needed: decisions; decisions required; needs decision; action decisions; decision items; what we decide
- Updates only: updates; for information only; status updates; information share; fyi items; info only
- Parking lot: parking lot; out of scope; deferred; not now; hold; off agenda

### 2. Work Trip Packing List
- ID: sort_bucket_002
- Difficulty: beginner
- Scenario: You are packing for a 2-day client presentation trip.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Work essentials, Travel documents & wallet, Clothing & personal
- Label word bank: Work essentials, Travel documents & wallet, Clothing & personal, Tech & gadgets, Business gear, Health & comfort, Accessories, Everyday carry, Professional items, Personal care
- Dual-bucket accepted items: Phone, Power bank, Headphones

Answer key:
- Work essentials: Laptop; Charger; Notebook; Pen
- Travel documents & wallet: Passport; Wallet; Phone; Power bank
- Clothing & personal: Dress shoes; Vitamins; Suit jacket; Headphones

Accepted label equivalents:
- Work essentials: work essentials; work gear; work tools; business tools; office supplies; work kit
- Travel documents & wallet: travel documents; travel docs; documents; id & payment; wallet & docs; travel & id
- Clothing & personal: clothing & personal; personal items; clothes & personal; apparel; clothing & wellbeing

### 3. Performance Review Feedback
- ID: sort_bucket_003
- Difficulty: intermediate
- Scenario: You have received the annual performance review for a team member. The notes were dumped into one list. Sort them into three clear categories.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Strengths to celebrate, Areas to develop, Actions to take
- Label word bank: Strengths to celebrate, Areas to develop, Actions to take, What's working, What needs work, Next steps, Keep doing, Stop doing, Start doing, Development areas
- Dual-bucket accepted items: None

Answer key:
- Strengths to celebrate: Consistently meets deadlines; Strong cross-team communicator; Takes initiative without prompting; Positive team culture contributor
- Areas to develop: Needs to improve executive communication; Presentation skills require work; Can be too detail-oriented in senior meetings; Struggles to prioritize under pressure
- Actions to take: Enroll in leadership training by Q3; Shadow a director in stakeholder meetings; Set monthly check-ins with manager; Complete conflict resolution workshop

Accepted label equivalents:
- Strengths to celebrate: strengths; what's working; keep doing; positives; demonstrated strengths
- Areas to develop: areas to develop; development areas; what needs work; improve; growth areas; development priorities
- Actions to take: actions; next steps; action items; to do; follow-ups; committed actions; action plan

### 4. Customer Complaint Inbox
- ID: sort_bucket_004
- Difficulty: intermediate
- Scenario: These are support tickets from your product team. Sort them by how they should be handled.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Fix immediately, Investigate further, Backlog & monitor
- Label word bank: Fix immediately, Investigate further, Backlog & monitor, Critical issues, Nice to have, Bugs, Feature requests, High priority, Low priority, Enhancements
- Dual-bucket accepted items: Security vulnerability reported by user

Answer key:
- Fix immediately: App crashes on login for 30% of users; Payment processing failing at checkout; Data not saving - users losing work; Security vulnerability reported by user
- Investigate further: Search bar shows no results for common queries; Feature X behaves differently on iOS vs Android; Search results seem inconsistent; Export function missing some records
- Backlog & monitor: User wants dark mode; Font size too small on mobile; Request to add keyboard shortcut; Onboarding tutorial feels outdated

Accepted label equivalents:
- Fix immediately: fix immediately; critical; p0; urgent; immediate action; fix now
- Investigate further: investigate further; needs investigation; look into; monitor; investigate
- Backlog & monitor: backlog; nice to have; low priority; future; wishlist; backlog & monitor

### 5. New Employee's First Week
- ID: sort_bucket_005
- Difficulty: advanced
- Scenario: You are starting a new job on Monday. Sort these tasks by when you should actually tackle them.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Do on Day 1, Complete by end of week, Don't rush - first month
- Label word bank: Do on Day 1, Complete by end of week, Don't rush - first month, Urgent, This week, Later, Immediate, Short-term, Long-term, Onboarding essentials
- Dual-bucket accepted items: Read the team handbook, Complete mandatory HR training

Answer key:
- Do on Day 1: Meet your manager; Get laptop and access set up; Read the team handbook; Introduce yourself to the team
- Complete by end of week: Schedule 1:1s with key stakeholders; Review last quarter's goals; Shadow a team meeting; Complete mandatory HR training
- Don't rush - first month: Form an opinion on team strategy; Build relationships with cross-functional teams; Propose any process changes; Learn the unwritten rules of the culture

Accepted label equivalents:
- Do on Day 1: do on day 1; day 1; immediate; first day; day one; day 1 essentials
- Complete by end of week: complete by end of week; this week; week 1; first week; short-term; week 1 goals
- Don't rush - first month: first month; long-term; take time; month 1; month 1 horizon; don't rush

### 6. Reasons a Project Is Off Track
- ID: sort_bucket_006
- Difficulty: advanced
- Scenario: These are findings from a project post-mortem. Sort them by root cause category.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: People & communication, Process & planning, Execution & delivery
- Label word bank: People & communication, Process & planning, Execution & delivery, Team issues, Planning failures, Output problems, Human factors, Structural problems, Delivery gaps, Root causes
- Dual-bucket accepted items: Cross-functional partner had different priorities, Feedback was vague and not actionable

Answer key:
- People & communication: Stakeholder wasn't looped in early enough; Team didn't flag risks to the manager; Cross-functional partner had different priorities; Feedback was vague and not actionable
- Process & planning: Scope was not defined clearly at the start; Timeline was too aggressive given resources; Dependencies weren't mapped before kickoff; Sign-off process was never agreed at kickoff
- Execution & delivery: Deliverable quality didn't meet expectations; Final deliverable was submitted without a quality review; Final output didn't match the brief; Testing was skipped due to time pressure

Accepted label equivalents:
- People & communication: people; communication; human factors; team issues; relationship; people & communication
- Process & planning: process; planning; structural problems; setup issues; process & planning; structural & planning
- Execution & delivery: execution; delivery; output problems; delivery gaps; execution & delivery; delivery breakdowns

## Member Diagnostic / Checkpoint: Sort & Bucket Sets
### 1. Meeting agenda from hell
- ID: sort_bucket_001
- Difficulty: beginner
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Decisions Needed, Updates Only, Parking Lot
- Label word bank: Decisions Needed, Updates Only, Parking Lot, Action Items, Discussion Topics, Information Share, Open Issues, Follow-Ups, Announcements, Next Steps
- Dual-bucket accepted items: Debate over office layout

Answer key:
- Decisions Needed: Q3 budget approval vote; Decision on vendor contract; Product launch go/no-go; Debate over office layout
- Updates Only: Project status from team leads; New org chart announcement; Policy change effective next month; Action items from last week
- Parking Lot: Someone's vacation dates; Team birthday celebration; Request for IT equipment; Uploading team photos from last offsite

Accepted label equivalents:
- Decisions Needed: decisions; decisions required; needs decision; action decisions; decision items; what we decide
- Updates Only: updates; for information only; status updates; information share; fyi items; info only
- Parking Lot: parking lot; out of scope; deferred; not now; hold; off agenda

### 2. Work trip packing list
- ID: sort_bucket_002
- Difficulty: beginner
- Scenario: You're packing for a 2-day client presentation trip.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Work Essentials, Travel Documents & Wallet, Clothing & Personal
- Label word bank: Work Essentials, Travel Documents & Wallet, Clothing & Personal, Tech & Gadgets, Business Gear, Health & Comfort, Accessories, Everyday Carry, Professional Items, Personal Care
- Dual-bucket accepted items: Phone, Power bank, Headphones

Answer key:
- Work Essentials: Laptop; Charger; Notebook; Pen
- Travel Documents & Wallet: Passport; Wallet; Power bank; Phone
- Clothing & Personal: Dress shoes; Suit jacket; Vitamins; Headphones

Accepted label equivalents:
- Work Essentials: work essentials; work gear; work tools; business tools; office supplies; work kit
- Travel Documents & Wallet: travel documents; travel docs; documents; id & payment; wallet & docs; travel & id
- Clothing & Personal: clothing & personal; personal items; clothes & personal; apparel; clothing & wellbeing

### 3. Performance review feedback
- ID: sort_bucket_003
- Difficulty: intermediate
- Scenario: You have received the annual performance review for a team member. The notes were dumped into one list. Sort them into three clear categories.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Strengths to Celebrate, Areas to Develop, Actions to Take
- Label word bank: Strengths to Celebrate, Areas to Develop, Actions to Take, What's Working, What Needs Work, Next Steps, Keep Doing, Stop Doing, Start Doing, Development Areas
- Dual-bucket accepted items: None

Answer key:
- Strengths to Celebrate: Consistently meets deadlines; Strong cross-team communicator; Takes initiative without prompting; Positive team culture contributor
- Areas to Develop: Needs to improve executive communication; Presentation skills require work; Can be too detail-oriented in senior meetings; Struggles to prioritize under pressure
- Actions to Take: Enroll in leadership training by Q3; Shadow a director in stakeholder meetings; Set monthly check-ins with manager; Complete conflict resolution workshop

Accepted label equivalents:
- Strengths to Celebrate: strengths; what's working; keep doing; positives; demonstrated strengths
- Areas to Develop: areas to develop; development areas; what needs work; improve; growth areas; development priorities
- Actions to Take: actions; next steps; action items; to do; follow-ups; committed actions; action plan

### 4. Customer complaint inbox
- ID: sort_bucket_004
- Difficulty: intermediate
- Scenario: These are support tickets from your product team. Sort them by how they should be handled.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Fix Immediately, Investigate Further, Backlog & Monitor
- Label word bank: Fix Immediately, Investigate Further, Backlog & Monitor, Critical Issues, Nice to Have, Bugs, Feature Requests, High Priority, Low Priority, Enhancements
- Dual-bucket accepted items: Security vulnerability reported by user

Answer key:
- Fix Immediately: App crashes on login for 30% of users; Payment processing failing at checkout; Data not saving - users losing work; Security vulnerability reported by user
- Investigate Further: Search bar shows no results for common queries; Feature X behaves differently on iOS vs Android; Search results seem inconsistent; Export function missing some records
- Backlog & Monitor: User wants dark mode; Font size too small on mobile; Request to add keyboard shortcut; Onboarding tutorial feels outdated

Accepted label equivalents:
- Fix Immediately: fix immediately; critical; p0; urgent; immediate action; fix now
- Investigate Further: investigate further; needs investigation; look into; monitor; investigate
- Backlog & Monitor: backlog; nice to have; low priority; future; wishlist; backlog & monitor

### 5. New employee's first week
- ID: sort_bucket_005
- Difficulty: advanced
- Scenario: You are starting a new job on Monday. Sort these tasks by when you should actually tackle them.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: Do on Day 1, Complete by End of Week, Don't Rush - First Month
- Label word bank: Do on Day 1, Complete by End of Week, Don't Rush - First Month, Urgent, This Week, Later, Immediate, Short-Term, Long-Term, Onboarding Essentials
- Dual-bucket accepted items: Read the team handbook, Complete mandatory HR training

Answer key:
- Do on Day 1: Meet your manager; Get laptop and access set up; Read the team handbook; Introduce yourself to the team
- Complete by End of Week: Schedule 1:1s with key stakeholders; Review last quarter's goals; Shadow a team meeting; Complete mandatory HR training
- Don't Rush - First Month: Form an opinion on team strategy; Build relationships with cross-functional teams; Propose any process changes; Learn the unwritten rules of the culture

Accepted label equivalents:
- Do on Day 1: do on day 1; day 1; immediate; first day; day one; day 1 essentials
- Complete by End of Week: complete by end of week; this week; week 1; first week; short-term; week 1 goals
- Don't Rush - First Month: first month; long-term; take time; month 1; month 1 horizon; don't rush

### 6. Reasons a project is off track
- ID: sort_bucket_006
- Difficulty: advanced
- Scenario: These are findings from a project post-mortem. Sort them by root cause category.
- Prompt: Sort the items into three clean buckets.
- Correct bucket labels: People & Communication, Process & Planning, Execution & Delivery
- Label word bank: People & Communication, Process & Planning, Execution & Delivery, Team Issues, Planning Failures, Output Problems, Human Factors, Structural Problems, Delivery Gaps, Root Causes
- Dual-bucket accepted items: Cross-functional partner had different priorities, Feedback was vague and not actionable

Answer key:
- People & Communication: Stakeholder wasn't looped in early enough; Team didn't flag risks to the manager; Cross-functional partner had different priorities; Feedback was vague and not actionable
- Process & Planning: Scope was not defined clearly at the start; Timeline was too aggressive given resources; Dependencies weren't mapped before kickoff; Sign-off process was never agreed at kickoff
- Execution & Delivery: Deliverable quality didn't meet expectations; Final deliverable was submitted without a quality review; Final output didn't match the brief; Testing was skipped due to time pressure

Accepted label equivalents:
- People & Communication: people; communication; human factors; team issues; relationship; people & communication
- Process & Planning: process; planning; structural problems; setup issues; process & planning; structural & planning
- Execution & Delivery: execution; delivery; output problems; delivery gaps; execution & delivery; delivery breakdowns

## Member Diagnostic / Checkpoint: Spot the Problem Sets
### 1. What makes feedback useful? / Traits of a great communicator
- ID: spot_problem_001
- Difficulty: beginner
- Scoring: 10 points for Part A and 10 points for Part B.

Part A topic: What makes feedback useful?

Part A buckets:
- Clarity: Describes specific behavior not general traits; Uses concrete examples from real situations; Avoids vague language like "be more professional"; States clearly what needs to change
- Timing & delivery: Given close to when the event happened; Delivered privately not in front of others; Doesn't use fuzzy phrases - is direct about the issue
- Actionability: Focuses on what the person can actually change; Suggests a specific path forward; Checks for understanding after giving feedback

Part A overlap pairs:
- Avoids vague language like "be more professional" / Doesn't use fuzzy phrases - is direct about the issue

Part B topic: Traits of a great communicator

Part B starter buckets:
- Clarity: Gets to the point quickly; Uses simple language
- Connection: Makes eye contact; Shows genuine interest
- Confidence: Holds their ground under pushback; Projects calm under pressure

Part B item bank:
- Listens before responding
- Adjusts message to suit the audience
- Speaks loudly in all situations
- Uses jargon to sound expert
- Avoids silence at all costs

Part B correct answers:
- Adjusts message to suit the audience: Clarity
- Listens before responding: Connection

### 2. What makes a strong project manager? / What builds trust at work?
- ID: spot_problem_002
- Difficulty: beginner
- Scoring: 10 points for Part A and 10 points for Part B.

Part A topic: What makes a strong project manager?

Part A buckets:
- Planning: Sets clear milestones; Defines what success looks like; Allocates resources early; Breaks work into manageable tasks
- Communication: Tells the team what winning looks like; Listens actively to the team; Updates stakeholders regularly; Keeps everyone informed on progress
- Delivery: Meets deadlines consistently; Holds the team accountable; Manages scope to avoid scope creep

Part A overlap pairs:
- Defines what success looks like / Tells the team what winning looks like
- Updates stakeholders regularly / Keeps everyone informed on progress

Part B topic: What builds trust at work?

Part B starter buckets:
- Reliability: Shows up consistently; Meets commitments without being chased
- Integrity: Tells the truth even when it is uncomfortable
- Transparency: Acknowledges mistakes quickly; Asks for input before deciding

Part B item bank:
- Does what they say they will do
- Shares information openly
- Takes credit for team wins
- Avoids difficult conversations
- Changes position when pressured

Part B correct answers:
- Does what they say they will do: Reliability
- Shares information openly: Integrity

### 3. What makes a presentation land? / What makes a team high-performing?
- ID: spot_problem_003
- Difficulty: intermediate
- Scoring: 10 points for Part A and 10 points for Part B.

Part A topic: What makes a presentation land?

Part A buckets:
- Structure: Opens with the key message not background; Covers only what the audience needs to know; Follows a logical flow from problem to solution; Ends with a clear call to action
- Delivery: Speaks with confidence and eye contact; Doesn't read from the slides; Paces the talk so key points land; Controls the rhythm so the audience can follow
- Audience fit: Removes anything irrelevant to this specific audience; Anticipates questions and addresses them early; Leaves one clear takeaway the audience remembers

Part A overlap pairs:
- Covers only what the audience needs to know / Removes anything irrelevant to this specific audience
- Paces the talk so key points land / Controls the rhythm so the audience can follow

Part B topic: What makes a team high-performing?

Part B starter buckets:
- Structure: Shared goals everyone understands; Decision-making process is clear
- Culture: Members trust each other; Disagreement is handled constructively
- Execution: Progress is tracked and visible; Accountability is shared not concentrated

Part B item bank:
- Clear roles so no one duplicates effort
- Psychological safety to speak up
- Everyone agrees with the leader always
- No conflict ever
- Works the longest hours

Part B correct answers:
- Clear roles so no one duplicates effort: Structure
- Psychological safety to speak up: Culture

### 4. Why do projects go off track? / What does executive presence look like?
- ID: spot_problem_004
- Difficulty: intermediate
- Scoring: 10 points for Part A and 10 points for Part B.

Part A topic: Why do projects go off track?

Part A buckets:
- People: Key stakeholder wasn't looped in early; Team didn't raise risks to the manager; Important person was left out of decisions; Cross-functional partner had competing priorities
- Process: Scope wasn't defined clearly at the start; No clear owner for key decisions; Timeline was too aggressive given resources; Nobody was accountable for the final call
- Execution: Deliverable didn't meet expectations; Progress wasn't tracked or escalated; Deadlines were missed and no one flagged it; Testing was skipped under time pressure

Part A overlap pairs:
- Key stakeholder wasn't looped in early / Important person was left out of decisions
- No clear owner for key decisions / Nobody was accountable for the final call
- Progress wasn't tracked or escalated / Deadlines were missed and no one flagged it

Part B topic: What does executive presence look like?

Part B starter buckets:
- Communication: Gets to the point without over-explaining; Frames ideas in terms of impact not activity
- Composure: Stays calm when things go wrong; Doesn't get defensive under challenge
- Awareness: Knows what matters to who is in the room

Part B item bank:
- Speaks with conviction even under uncertainty
- Reads the room and adjusts in real time
- Always has the loudest voice in the room
- Never shows any emotion
- Agrees with the most senior person present

Part B correct answers:
- Speaks with conviction even under uncertainty: Communication
- Reads the room and adjusts in real time: Awareness

### 5. What makes someone ready for promotion? / What makes a decision well-made?
- ID: spot_problem_005
- Difficulty: advanced
- Scoring: 10 points for Part A and 10 points for Part B.

Part A topic: What makes someone ready for promotion?

Part A buckets:
- Performance: Consistently exceeds what the role requires; Delivers results without needing to be told; Goes beyond the expectations of the current job; Gets things done even in ambiguous situations
- Leadership: Others seek them out for advice and input; Brings people together around a shared goal; Takes initiative and drives things forward; Rallies the team toward a common direction
- Readiness: Has already shown they can do the next job; Understands how decisions get made at the next level; Is already operating at the level above; Knows what matters to senior stakeholders

Part A overlap pairs:
- Consistently exceeds what the role requires / Goes beyond the expectations of the current job
- Brings people together around a shared goal / Rallies the team toward a common direction
- Has already shown they can do the next job / Is already operating at the level above

Part B topic: What makes a decision well-made?

Part B starter buckets:
- Thinking: Uses available data without waiting for perfect information; Weighs trade-offs explicitly
- Process: Involves the right people at the right level
- Outcome: Can be explained and defended clearly; Is revisable if new information emerges

Part B item bank:
- Considers second-order effects not just the immediate outcome
- Is made at the right time - not too early or too late
- Is made by whoever shouts loudest
- Never changes once made
- Avoids any input from others

Part B correct answers:
- Considers second-order effects not just the immediate outcome: Thinking
- Is made at the right time - not too early or too late: Process

## Member Diagnostic / Checkpoint: Speak Concisely Topics
### 1. The chicken contact lens startup
- ID: speak_concisely_001
- Difficulty: beginner
- Category: Business pitch
- Time limit: 90 seconds
- Scenario: You have 90 seconds to pitch this idea to a room of investors who have heard everything. Make them lean forward.

Facts available to the learner:
- The science is real: Red-tinted contact lenses make chickens measurably less aggressive, reduce pecking, and increase egg production. The idea comes from real 1980s science that never scaled commercially.
- The problem is large: The global poultry industry is worth $400 billion and loses an estimated $2 billion annually to aggressive flock behavior and injuries.
- Current solutions are under pressure: Beak trimming and sedatives face increasing regulatory pressure across the EU and are banned in 12 countries.
- Early trial results are promising: A farm trial in the Netherlands showed a 22% reduction in flock injuries and a 9% increase in egg yield over 3 months using prototype soft lenses.
- The business model can recur: Manufacturing cost is $0.04 per lens at scale, the product lasts 6 weeks, and the model is a farmer subscription.

Key messages expected in the response:
- There is a real, large, and unsolved problem in the poultry industry.
- The science works and there is early proof from a live trial.
- The business model is viable and recurring.

### 2. Your instant noodle brand is on fire in the wrong way
- ID: speak_concisely_002
- Difficulty: beginner
- Category: Operations update under pressure
- Time limit: 90 seconds
- Scenario: You run a regional instant noodle brand. A food blogger just posted that your spicy shrimp flavor tastes like scented candle water. It has 2 million views. Your CEO wants a briefing in the next 10 minutes.

Facts available to the learner:
- The issue is already viral: The video went viral 4 hours ago. Social mentions are up 1,800%, and sentiment is 67% negative.
- The supplier changed the product: The formulation was unchanged, but a supplier switched one ingredient without notifying you, which altered the aroma profile.
- The risk appears contained: Batch 4471 includes about 80,000 units across three markets. No safety issue has been identified.
- Retail partners are already reacting: Three retail partners have asked whether to pull the product from shelves. One has already done so unilaterally.
- The decision window is short: PR recommends a proactive statement within 2 hours. Legal recommends waiting until the supplier investigation is complete.

Key messages expected in the response:
- What happened and what we know, including batch 4471, supplier issue, and no safety risk.
- What is at stake right now, including retail partners, reputation, and the 2-hour decision window.
- A clear recommended next step with a rationale.

### 3. Why your city should host the world's first UFO tourism festival
- ID: speak_concisely_003
- Difficulty: intermediate
- Category: Persuasion to a skeptical audience
- Time limit: 90 seconds
- Scenario: You are the head of the city tourism board. Your mayor gives you 90 seconds at the next council meeting to make the case for why your city should invest $2M in a UFO tourism festival. Half the room thinks you are joking.

Facts available to the learner:
- The tourism model already works: Roswell, New Mexico generates $95M annually in UFO-related tourism despite having a population of 48,000.
- The market is growing: Google searches for UFO tourism have grown 340% since 2020 after the US government declassified UAP reports.
- The city has a real advantage: Your city has three documented UAP sighting hotspots within 40km, a disused air force base, and no competing festival in the region.
- The economics can work: A conservative model projects 12,000 visitors in year one at an average spend of $280, creating $3.36M in direct visitor spend against a $2M investment.
- Local partners are ready: Three hotels, two catering companies, and a tour operator have signed letters of intent if the council approves the budget.

Key messages expected in the response:
- This is a proven and growing market, not a joke.
- Our city has a unique and unfair advantage.
- The economics work with positive ROI and private sector commitment.

### 4. Your company's new nap room is causing a war in the office
- ID: speak_concisely_004
- Difficulty: intermediate
- Category: Internal recommendation under divided opinion
- Time limit: 90 seconds
- Scenario: You are the head of people operations. The CEO just saw a study on nap rooms and wants one. Half the leadership team thinks it is brilliant. The other half thinks it signals laziness to clients. You have 90 seconds to give your recommendation at the next leadership meeting.

Facts available to the learner:
- The science supports short naps: NASA research shows a 26-minute nap improves performance by 34% and alertness by 54% in pilots.
- Employees already feel the problem: 61% of staff report afternoon energy slumps that affect work quality, and only 12% feel comfortable taking breaks away from their desks.
- Comparable companies have precedent: Nike, Google, Ben and Jerry's, and Huffington Post all have sleep pods or dedicated rest spaces without reported client perception issues.
- The cost is relatively low: Converting one unused conference room costs about $8,000 once. One disengaged employee is estimated to cost $16,000 annually in lost productivity.
- Leadership behavior is inconsistent: Three senior leaders privately nap in their cars at lunch. Two call a nap room too casual for the culture without citing evidence.

Key messages expected in the response:
- The science and internal data both support this.
- The client perception concern is not supported by comparable company precedent.
- A clear recommendation with the key condition or caveat.

### 5. Your school came last in every subject and you think that is a good thing
- ID: speak_concisely_005
- Difficulty: advanced
- Category: Reframing a bad metric under pressure
- Time limit: 90 seconds
- Scenario: You are the principal of a school that ranked last in the district on standardized tests this year for the third year in a row. The school board wants answers. You have 90 seconds to give them your take before they vote on leadership changes.

Facts available to the learner:
- The school serves a harder context: 74% of students are English-language learners working in their second or third language, the highest proportion in the district.
- Growth tells a different story: On a value-added measure that tracks improvement from each student's starting point, the school ranked 2nd in the district.
- Community signals are strong: Parent satisfaction is the highest in the district for the second consecutive year, and teacher retention is 94% versus a district average of 71%.
- Student outcomes are breaking barriers: Three of last year's graduates are now in university programs, including one with a full scholarship.
- The ranking metric is incomplete: The district uses raw test scores as its only ranking metric, and no comparable school has ever finished above 3rd on that measure.

Key messages expected in the response:
- The ranking metric is wrong for our context because raw scores ignore starting points.
- The right measures show we are performing exceptionally well.
- A clear ask for what we need from the board to continue.

## Member Diagnostic / Checkpoint: Act Confidently
### 1. Act confidently
- ID: act_confidently_placeholder_001
- Status: placeholder
- Difficulty: placeholder
- Prompt: This assessment is coming soon.

## Notes for Reviewers
- The Sort & Bucket and Spot the Problem answer keys are deterministic, with a small number of accepted dual-bucket or label-equivalent cases.
- Speak Concisely is partly rubric-based. Exact scores can vary if the external AI scorer is used, but the point categories and timing penalties are fixed in the app.
- The Grocery list exercise is intentionally lower-stakes practice. It should be reviewed for clarity and usefulness, not numeric scoring precision.
