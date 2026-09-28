# Non-scored transport calibration

## Attempt A: b76d114

Stopped normally with exit 1 before any main-model call. Three Jev HTTP-200 requests completed: indexed Noul, direct Noul and graded Score, with 64 judgments each. The first two passed. The third exposed an overly strict response validator, not a quality result: the provider returned Score 2.83 with printed probabilities .05/.01/.02/.92, whose weighted mean is 2.81. Both representations are independently rounded.

Known input/output tokens: indexed 23,661/1,146; direct 24,304/1,146; graded 24,624/954. HTTP latencies were 522/284/404ms respectively. No development or held-out dataset case was used. The synthetic source fact was Kyoto / MAPLE-417.

The validator now allows only the mathematically bounded discrepancy from two-decimal rounding: for four probabilities, mass tolerance 4×.005 = .02; for levels 0..3, expected-score tolerance (0+1+2+3)×.005 + .005 = .035. Bounds, model identity, exact answer coverage and probability domains remain strict. A regression reproduces the observed response. Graded wording now explicitly asks for a usefulness rating against the supplied levels rather than using yes/no wording.

All attempt-A requests, sanitized responses, rankings, manifest and failure record remain at `/data/native-recall-calibration-b76d114-a` on Eve, with adjacent exit and launch records. They are not efficacy evidence and are not silently overwritten. A subsequent separately identified calibration must validate the complete native Agent path before development runs begin.
