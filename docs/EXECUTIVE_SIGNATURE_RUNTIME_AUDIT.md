# Executive Signature runtime audit

## Decision

Both assessment tiers generate complete results without GenAI at runtime. The browser calculates scores from fixed item IDs and answer values, selects copy from versioned local rules, renders the result, and prints the same rendered report to PDF.

| Output | Quick Check | Full Assessment | Runtime source |
| --- | --- | --- | --- |
| Profile name | Deterministic | Deterministic | Fixed profile lookup from the Voice and Drive axes |
| Executive Signature sentence | Deterministic | Deterministic | Fixed profile copy with a readiness-area fallback |
| Executive Edge | Deterministic | Deterministic | Most distinctive style area or facet |
| Executive Unlock | Deterministic | Deterministic | Lowest readiness area |
| Executive Readiness Score | Deterministic | Deterministic | Arithmetic from scored readiness areas or facets |
| Readiness range | Deterministic | Deterministic | Fixed score thresholds |
| Area and facet descriptions | Deterministic | Deterministic | Versioned local copy maps |
| Share card | Deterministic | Deterministic | Rendered from the Signature result without a numeric score |
| PDF | Not offered | Deterministic | Browser print of the rendered Full Assessment report |

## External calls

The assessment can send a result email payload and save an assessment record. Those calls store or deliver an already generated result. They do not create, rewrite, interpret, or score any part of the result.

## Reliability rules

- The same answers and form version produce the same scores and result copy.
- Item display order does not affect scoring.
- Resumed attempts retain their stored item order.
- Signature output has complete fallback copy when a style facet is unavailable.
- Boundary tests cover the established profiles and score cutoffs from 0 through 100.

## Maintenance note

If an AI-generated interpretation is added later, it must be clearly optional. The deterministic result and PDF must remain complete when that service is unavailable.
