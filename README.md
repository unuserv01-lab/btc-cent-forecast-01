# btc-cent-forecast-01 entry

Forecasts Bitcoin's US-dollar price 240 minutes after each checkpoint, from the
case's own 4,320 one-minute closes (72 hours up to the checkpoint).

## Method

An honest median of the price at the horizon: the average of the 1-hour and
4-hour mean log-returns, shrunk 0.4 toward zero (recent drift carries a little
signal but is mostly noise), plus a 0.25 pull of the log-price toward its own
240-minute moving average, with the total move clamped to 1.25× the realised
4-hour volatility so a freak minute cannot throw the guess far from the
checkpoint. No look-ahead, no hard-coded prices, no network, no randomness —
fully deterministic.

## Run locally

```sh
mkdir -p out && MAKEFUN_INPUT_DIR=input MAKEFUN_OUTPUT_DIR=out node main.ts
```

Reads every `*.in` in the input directory and writes `<id>.out` per case:
`{"forecasts":[{"case":"<id>","price":<number>}]}`.

## Practice result

On the kit's six practice cases, evaluated on p00–p04 (each target is the next
case's last close; p05's target is not in the kit): MAE **32,596 cents** vs
**47,055 cents** for the persistence baseline on the same five cases (~31%
lower). The practice is graded on past prices and pays nothing, so this is no
guide to the final — it only shows the method beats guessing the price does
not move on this window.
