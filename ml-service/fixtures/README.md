# Eval fixtures

Each folder is a tiny repo plus `expected.json`. Matching key is
`(file, line, type)`, the same key the merge step dedupes on.

| Fixture | Purpose | Expected |
| ------- | ------- | -------- |
| `repo_01_unprotected_route` | two admin routes lack auth; one profile route is guarded | 2 route-security findings |
| `repo_02_failing_test` | `node --test` assertion is wrong | 1 failing-test finding |
| `repo_03_slow_endpoint` | protected report route sleeps 750 ms | 1 slow-endpoint finding |
| `repo_04_complex_function` | deeply nested pricing function | 1 high-complexity finding |
| `repo_05_clean` | public + guarded routes only, simple util | **zero findings** |

`expected.json` findings that belong to analyzers not built yet are reported as
`missed [analyzer not implemented yet]`; they still count against recall.

The data-mapping analyzer has no fixture of its own (the five repos were fixed
by the spec), so it is covered by `tests/test_data_mapping.py` plus the zero
false alarms it must keep on `repo_05_clean` and the real repo.
