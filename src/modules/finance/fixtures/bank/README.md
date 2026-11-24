# Bank statement fixtures (T117)

**Synthetic data.** Written by hand from the published MT940 field definitions (`docs/studies/bank-statement-formats.md`), not exported by a bank: the account numbers (`9999990000…`), references (`SYNTHETIC…`, `SYN…`) and amounts are made up. Replace or complete them with real statement files from the pilot's banks once there are some.

- `synthetic-one-statement.sta`: one MT940 statement in a SWIFT FIN envelope, CRLF, 1–14 March 2026; the same operations as T111's two-week fixture (`bank.int.test.ts`). A funds code (`DD1200,`) and a two-line `:86:`.
- `synthetic-multi-statement.sta`: two statements of one account, plain messages separated by `-`. The first is split over two pages (`:62M:` / `:60M:`), opens overdrawn (`D`), crosses the new year (value 31 Dec, entry 2 Jan), and has RC / RD reversals and a three-line `:86:`. The second has no entry date and no bank reference, and closes at `0,`.
- `synthetic-debit-credit.csv`: a spreadsheet export in Windows-1252, `;`, decimal comma, a header row, debit and credit columns, quoted cells and a balance row without a date.

`.gitattributes` keeps the bytes as written (CRLF), since the tests read them byte for byte.
