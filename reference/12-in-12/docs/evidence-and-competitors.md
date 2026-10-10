# 12 in 12 evidence and competitor brief

> **The Faculty: UTL product leadership** 
> Professor (strategy) · Buzz (growth) · Sherlock (research) · Gizmo (design and engineering) · Bolt (security)
>
> **Accountable:** Sherlock · **Contributors:** none yet · **Temporary specialists:** none · **Last updated:** 2026-10-10 · **Status:** Draft input, not approved. · **Source of truth:** this file

## Short answer

Habit research supports a gentle, flexible tracker and does not support any promise of a fixed number of days to a habit. **Source quality warning:** WebFetch could not reach any vendor site (DNS failure), and the paper searches returned secondary summaries. I did not read any primary paper or vendor page. Every item below is therefore secondary, and prices need a check against the live store pages before use. Accessed 2026-10-10.

## 1. Habit formation research

- **Timing, published research with limits:** Lally, Van Jaarsveld, Potts and Wardle, European Journal of Social Psychology (published online 2009, issue year 2010). 96 volunteers, 12 weeks, one daily behavior. Median 66 days to plateau of automaticity, range 18 to 254 days. The curve fit well for only 39 people, and results rest on extrapolation. Source seen via the [BPS Research Digest](https://bps.org.uk/research-digest/how-form-habit) and a [secondary critique](https://www.thebehavioralscientist.com/articles/how-long-to-form-a-habit).
- **Missed days, published research via summary:** Lally reported that one missed opportunity did not materially harm habit formation, while several in a row slowed it. This supports forgiving design. Confidence is moderate because I read it only secondhand.
- **The 21 days claim, reasoned inference:** It traces to Maltz, *Psycho-Cybernetics* (1960), an anecdote about patients and not habit data. Secondary source only.
- **Implementation intentions, published research:** Gollwitzer and Sheeran (2006), *Advances in Experimental Social Psychology*, 38, 69 to 119. Reported mean effect d = 0.65 across 94 tests. The figure comes from [secondary pages](https://stafforini.com/works/gollwitzer-2006-implementation-intentions-and/) that I could not match to the chapter. It is goal attainment in mostly short studies, not long-run habit.
- **Streaks and loss aversion, weak or contested:** A Management Science study summarized on [phys.org](https://phys.org/news/2024-03-streaks.pdf) found streaks motivate, even artificial ones. I found no trial linking streak design to lasting habits. Vendor claims of lifts (for example [FitCraft](https://getfitcraft.com/science/how-fitcraft-uses-research)) are marketing. The 2x loss aversion ratio is general economics, not streak data.
- **Self-compassion after a lapse, mixed:** Adams and Leary (2007), Journal of Social and Clinical Psychology, 26(10), 1120 to 1144, found a self-compassion induction reduced overeating after a diet break in restrictive eaters (college women, lab setting). A [2021 PMC study](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC8451927/) found self-compassion raised intentions to continue but did not predict weight loss.
- **"Never miss twice":** This is a popular maxim. I found no research that tests it by name. Treat it as a design principle only (reasoned inference from the Lally missed-day finding).

**UTL must not claim** that habits form in 21 or 30 days, that 66 days is typical for everyone, that streaks cause habits, or that self-compassion guarantees recovery.

## 2. What Partial and the "what got in the way" note can support

- **Reasoned inference:** Partial lowers all-or-nothing framing and fits the missed-day evidence above. It likely keeps people logging after a weak day.
- **Reasoned inference:** The note works as a lightweight obstacle prompt. It resembles the "if-then" planning in implementation intentions, because naming a barrier lets a user write a plan for it.
- **Unvalidated hypothesis:** Partial improves retention versus a two-state design. Test with an A/B in a later build.
- **Direct observation:** The recovered code already has the three statuses and a note panel (`reference/12-in-12/OLD/20260717-original/app.js` line 4, `index.html` lines 1092 to 1104).
- **Limit:** Partial is self-defined, so it can inflate or deflate progress. Define it in the interface (for example "less than planned").

## 3. Competitor scan

Prices come from search results, not vendor pages. Verify before any comparison is published.

| Product | Model and price (secondary) | Core mechanic | Sharing | Gap for UTL |
|---|---|---|---|---|
| Streaks | One-time purchase, sources disagree between $4.99 and $5.99 ([Toolradar](https://toolradar.com/tools/streaks/pricing), [Daring Fireball](https://daringfireball.net/linked/2024/11/30/streaks-and-little-streaks)) | Daily streaks, capped task count | Not confirmed | No monthly arc, no reflection note |
| Habitica | Free, optional subscription listed from $4.99 monthly ([App Store](https://apps.apple.com/eg/app/id994882113)) | Role-playing game rewards | Parties and guilds | Heavy gamification, not private or calm |
| Way of Life | Free with in-app premium, $4.99 to $29.99 ([App Pricing Lab](https://apppricinglab.com/iap/apple/393159800), snapshot 2026-07-02) | Color-coded yes, no, skip, with notes | Not confirmed | Closest rival, no challenge structure |
| Coach.me | App free, coaching about $25 a week or $87 a month ([support page](https://support.coach.me/article/39-cost)) | Tracker plus paid human coaches | Community | Paid coaching, not local-first |
| Duolingo | Free, Super subscription (price not retrieved) | Streak with paid or gem-based freeze and repair ([guides](https://duolingoguides.com/super-duolingo-streak-repair/)) | Friends features not checked | Streak anxiety is monetized, UTL can do the opposite |

I did not scan a 30 day challenge app. That is a gap. **Reasoned inference:** None found combine local-first privacy, a forgiving Partial status, and a one-challenge-per-month arc.

## 4. Is "twelve challenges in twelve months" evidenced?

**Reasoned inference:** It is a motivational framing. I found no study testing a twelve-month, one-habit-per-month sequence. Lally supports that one behavior at a time is workable, and a month is shorter than the 66 day median, so a month does not by itself form a habit. Honest wording is "a year of small experiments, one per month" and not "build twelve habits." Offer the option to continue a challenge into the next month.

## 5. Three measurable outcomes

Privacy rule. Collect nothing by default. Use opt-in, aggregate, non-identifying counts only, and ask Bolt before any telemetry.

- **Retention, unvalidated hypothesis:** Share of users who log on at least 3 days in week 4. Measure by an opt-in anonymous counter, or by an in-app prompt to export a summary the user chooses to send.
- **Completion:** Share of started months with at least 20 days logged and share who start month two. Measure from the local data on device, shown to the user only, plus the same opt-in counter.
- **Behavior change:** Self-reported change at month end ("Is this easier than at the start?") and the Done share in week 4 versus week 1. This is self-report, not proof of a lasting habit. A controlled design needs consenting volunteers and a founder-approved study.

## 6. Claims

**Safe to make, verified or directly observed**
- Private, stored on your device, no account (matches `index.html` line 1179, which also warns data can be lost if the browser is cleared).
- Log Done, Partial or Missed, add a note, see a calendar and progress bar.
- Provides a template library across Body, Mind, Focus, Social and Learning.

**Need qualification**
- "Research shows habits take 66 days" needs "on average in one small study, with a huge range."
- "Streaks keep you motivated" needs "may help some people" and no habit-formation claim.
- "Missing a day will not ruin your habit" is reasonably supported by Lally, so say "in one study."
- "Self-compassion helps you bounce back" needs evidence wording as above.
- Brand promise (Think clearly, Speak concisely, Act confidently) is a brand statement and must not be presented as a measured outcome.

**Never claim:** that the tracker changes behavior, cures procrastination, or builds twelve habits.

## Open questions

- Should the product page name competitors at all? Founder decision.
- Who verifies live prices and the original Lally and Gollwitzer texts? Next step is a primary-source check, which I recommend before any public copy.
