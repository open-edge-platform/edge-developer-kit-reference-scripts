# Sample Questions for NLQ Testing

## Basic Queries (Simple SELECT, Aggregation)

### 1. Overall Statistics
- "How many test sessions do we have in the database?"
- "What's the total number of tests passed and failed?"
- "How many different users are in the system?"
- "What's the overall pass rate?"

### 2. Daily/Weekly Performance
- "Show me the pass rate by day for the last 7 days"
- "How many tests failed on Monday?"
- "What was the yield on 2026-02-10?"
- "Compare pass/fail rates between EMS02 and EMS03"

### 3. Station & Equipment Performance
- "Which station has the highest failure rate?"
- "List all stations and their test counts"
- "How many times did the Motor Drive FCT run this month?"
- "Show the heater control failing tests"

---

## Intermediate Queries (Joins, Filtering)

### 4. Error Analysis
- "What are the most common error codes?"
- "Show me all tests that failed with ERR003"
- "Which step fails most often in the Motor Drive recipe?"
- "How many tests failed due to supply voltage issues?"

### 5. User & Operator Performance
- "Which operator ran the most tests?"
- "Show me tests run by Ahmad Razak in February"
- "List all operators and how many tests they performed"
- "Who had the best pass rate?"

### 6. Contractor Comparison
- "Compare yield between Acme EMS, Delta Manufacturing, and Vertex Tech"
- "Which contractor has the most failed tests?"
- "Show pass rates by contractor for the last 14 days"
- "Do any contractors have machines with 100% yield?"

### 7. Session Details
- "Get details for the test session MD-EMS01-260105-0001"
- "Show all tests for serial number MD-EMS02-260210-0042"
- "List tests run on specific station 'X590 Motor Drive FCT'"
- "Show the duration of all tests on 2026-02-15"

---

## Advanced Queries (Complex Joins, Aggregations, Subqueries)

### 8. Recipe & Process Analysis
- "Which recipe has the lowest pass rate?"
- "For Motor Drive recipe, which test step fails most?"
- "Show average duration and pass rate per recipe"
- "Which process steps have the highest failure rates?"

### 9. Trend Analysis
- "Is our yield improving or declining over time?"
- "Show the weekly trend of failures"
- "How did the bad batch week affect our yield?"
- "Compare performance before and after maintenance dates"

### 10. Retest Analysis
- "How many retests did we perform?"
- "What percentage of failed units were retested?"
- "Show retest success rate by contractor"
- "Which serial numbers had the most retests?"

### 11. Multi-Condition Queries
- "Show all sessions with duration > 60 seconds that passed"
- "List failed Motor Drive tests from Acme EMS in January"
- "Get tests that failed at station 1 cavity 2 with error code ERR005"
- "Show high-duration Heater Control tests run by engineers"

### 12. Summary Reports
- "Generate a daily summary: date, total tests, pass count, fail count, pass rate"
- "Show test volume and pass rate by contractor and recipe"
- "List top 5 most-used stations with their test counts and yields"
- "Create a summary of errors: error code, description, count, percentage"

---

## Edge Cases & Special Scenarios

### 13. Time-Based Queries
- "Show all tests run during night shift (after 6pm)"
- "How many tests completed in less than 5 seconds?"
- "Which days had zero failures?"
- "Show peak testing hours"

### 14. Data Quality & Anomalies
- "Are there any tests with duration of 0?"
- "Show sessions with missing error descriptions"
- "List tests with unusual pass rates compared to their station average"
- "Show duplicate serial numbers"

---

## Testing Strategy

### Phase 1: Warm Up (Test Basic Connectivity)
Start with questions 1-3 to verify:
- Database connection works
- Basic aggregation queries generate correctly
- LLM prompt formatting works

### Phase 2: Schema Understanding (Test Joins)
Test questions 4-7 to verify:
- Joins across OutputLog, User, UUTInfo tables
- WHERE clause filtering
- GROUP BY / ORDER BY
- Column name resolution

### Phase 3: Complex Queries (Test Advanced Logic)
Test questions 8-12 to verify:
- Multi-table joins
- Subqueries
- Window functions (if needed)
- Aggregations with multiple grouping levels

### Phase 4: Edge Cases (Test Robustness)
Test questions 13-14 to verify:
- Time/date handling
- NULL value handling
- Unusual data patterns
- Error recovery

---

## Suggested Test Sequence

**For 10% data scale (fastest):**
```
Q1 → Q2 → Q4 → Q5 → Q6 → Q8 → Q11 → Q13
(~2 min total)
```

**For 50% data scale (balanced):**
```
Q1-Q3 → Q4-Q7 → Q8-Q10 → Q12-Q14
(~5 min total)
```

**For 100% data scale (complete):**
```
All questions in order above
(~10 min total)
```

---

## How to Use with the System

### Option A: Interactive Testing via CLI
```bash
# Start the MCP ODBC server
cd mcp_odbcserver
python server.py

# In another terminal, test via nl_query.py
cd ..
python -i nl_query.py
>>> nlq = NaturalLanguageQuery()
>>> result = nlq.convert_to_sql("What's the overall pass rate?")
>>> print(result)
```

### Option B: Testing via Python REPL
```python
from mcp_odbcserver.nl_query import NaturalLanguageQuery
nlq = NaturalLanguageQuery()

queries = [
    "How many test sessions do we have?",
    "What's the overall pass rate?",
    "Which contractor has the best yield?"
]

for q in queries:
    print(f"\nQ: {q}")
    sql, explanation = nlq.convert_to_sql(q)
    print(f"SQL: {sql}")
    print(f"Explanation: {explanation}")
```

### Option C: Testing via MCP Chat Interface
```
If using Claude or other MCP client:
"Use the database tools to analyze: How many tests failed in February?"
```

---

## Expected Query Patterns

The system should generate queries that:

✅ **Correct:**
- `SELECT COUNT(*) FROM OutputLog WHERE OverallResult = 'Pass'`
- `SELECT ContractorName, OverallResult, COUNT(*) FROM OutputLog GROUP BY ContractorName, OverallResult`
- `SELECT u.Name, COUNT(o.ID) FROM OutputLog o JOIN User u ON o.UserID = u.ID GROUP BY u.Name ORDER BY COUNT(*) DESC`

❌ **To Avoid:**
- Missing JOIN conditions
- Incorrect table/column names (should be caught by schema_bootstrap meta)
- WHERE conditions on the wrong table
- Malformed SQL syntax

---

## Debugging Tips

If a query fails:

1. **Check the generated SQL** — Is it valid SQLite syntax?
   - Most common issue: column name typos
   - Solution: Verify against `databases/*_meta.json` column_aliases

2. **Check for JOIN issues** — Are all required tables included?
   - Test queries with WHERE on multiple tables
   - Verify meta["joins"] config includes all needed relationships

3. **Check aggregation logic** — GROUP BY matches SELECT columns?
   - Verify schema_bootstrap is detecting recipe/contractor correctly
   - Run `python schema_bootstrap.py --db central` to regenerate meta

4. **Check LLM formatting** — Is the prompt being built correctly?
   - Enable debug logging in nl_query.py
   - Check `_get_domain_context()` output

---

## Notes

- Database is generated with realistic EMS contractor data (Acme EMS, Delta Manufacturing, Vertex Tech)
- Bad batch weeks: EMS01 week 4, EMS02 week 6, EMS03 week 8
- Maintenance events: 2026-02-10 (EMS01), 2026-02-15 (EMS02), 2026-02-20 (EMS03)
- Data covers Jan 5 - Mar 12, 2026 (66 days of workdays only)
- Two machine types: Motor Drive FCT, Heater Control FCT
