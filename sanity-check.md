# Codebase Sanity Check Instructions

This file tells the AI coding assistant how to periodically audit this codebase for sanity, correctness, maintainability, and architectural quality.

The goal is not to blindly rewrite everything. The goal is to detect nonsense, fragility, overengineering, bad abstractions, duplicated systems, AI hallucinations, and code that technically exists but does not make sense. Just detect code that is bad in general too.

This codebase contains fully AI-generated code. Do not assume that code is correct just because it compiles, has professional-looking names, or appears organized.

A very important thing to do is divide into 4 stages: diagnose, plan, implement, verify. first diagnose, then wait for the user to say to plan, then make the plan, then wait for the user to say implement, then remind the user to ask you to verify.

---

## Core Mission

When asked to sanity-check the codebase, examine it for:

- Best practices
- Good software design
- Good architecture
- Good systems design
- Simplicity
- Maintainability
- Correctness
- Performance problems
- Type safety problems
- Unnecessary complexity
- AI-generated nonsense
- Duplicate or competing systems
- Bad abstractions
- Misleading names
- Dead code
- Half-integrated features
- Broken assumptions
- Unnecessary middlemen or intermediaries
- Systems/code/etc that can be streamlined without quality loss
- Incorrect order of operations, and I don't mean math I mean that code is called in the correct order, one system before another if it should be, and so on
- One system that should actually be multiple systems
- Opportunities to generalize overly specific systems, especially if there are multiple overly specific systems essentially doing the same thing a generalized system could do to replace them

---

## Required Mindset

Do not be impressed by complexity.

Do not assume an abstraction is good just because it has names like:

- Manager
- Service
- Controller
- Registry
- Provider
- Adapter
- Factory
- Coordinator
- Engine
- System
- Handler
- Pipeline
- Context
- Resolver
- Orchestrator

These may be valid, but they must justify their existence.

Every layer should answer:

> What problem does this solve that would be worse without it?

If the answer is unclear, flag it.

---

## First Pass: Understand the Codebase

Before judging individual files, build a rough mental model of the project.

Look for:

- Main entry points
- Runtime/client/server boundaries
- Core domain concepts
- Major systems
- Data flow
- Event flow
- State ownership
- Important configuration files
- Build/test/typecheck scripts
- External dependencies
- Folder structure

Do not make major recommendations until you understand how the pieces connect.

---

## Check for AI-Generated Nonsense

Actively look for code that appears plausible but is actually useless, wrong, or disconnected.

Flag code that:

- Has impressive names but no meaningful responsibility
- Wraps a simple function in multiple pointless layers
- Defines interfaces with only one implementation for no good reason
- Creates abstractions before there is a real need
- Has methods that are never called
- Has classes that only forward calls to another class
- Has configuration options that are never used
- Has comments that claim behavior the code does not implement
- Has error handling that only logs and continues incorrectly
- Has TODOs pretending to be implemented behavior
- Has fake fallback logic that hides real bugs
- Has dead branches that can never execute
- Has types that do not match runtime behavior
- Has duplicate systems solving the same problem differently
- Has old abandoned code still wired into nothing
- Has files that look important but are not imported anywhere

Do not assume comments are true. Verify against actual code.

---

## Check for Unnecessary Middlemen

Look for unnecessary intermediaries.

A middleman may be unnecessary if it:

- Only forwards calls without adding validation, policy, caching, transformation, isolation, or meaningful naming
- Exists only so another file can call through it
- Adds indirection without reducing complexity
- Makes debugging harder
- Obscures ownership of state
- Creates extra places where bugs can hide
- Has no clear reason to exist besides "architecture"

Example of a suspicious pattern:

```ts
fooService.doThing()
  -> fooManager.doThing()
  -> fooController.doThing()
  -> fooHandler.doThing()
  -> actualFunction()
```

This may be valid only if each layer has a clear responsibility.

Valid reasons for an intermediary include:

- Separating client and server code
- Isolating external libraries
- Enforcing permissions or validation
- Translating between data formats
- Managing lifecycle
- Managing caching
- Preserving a stable public API
- Coordinating multiple lower-level systems
- Handling cross-cutting concerns in one place

If it does none of these, recommend removing or collapsing it.

---

## Check Architecture Boundaries

Verify that important boundaries are respected.

Look for:

- Client code importing server-only modules
- Server code relying on browser-only APIs
- Domain logic mixed into UI code
- UI logic mixed into core systems
- Persistence/database code leaking everywhere
- Network code tightly coupled to game/domain logic
- Feature code reaching into unrelated internals
- Circular dependencies
- God files or god classes
- Global mutable state used casually
- Systems that know too much about each other
- This project is separated into an engine and a game, and game code can import engine code but engine code must never import game code

Ask:

> Could this system be understood, tested, or replaced independently?

If not, explain why.

---

## Check State Ownership

For every important piece of state, determine who owns it.

Flag:

- State duplicated in multiple places without synchronization rules
- State mutated from many unrelated files
- Cached state with no invalidation strategy
- Client state treated as authoritative when it should not be
- Server state modified indirectly through unclear side effects
- Global state used where explicit ownership would be better
- State initialized in one place and secretly mutated elsewhere
- Data that can become stale without detection

For multiplayer or networked code, be especially strict about authority.

The code should make it clear:

- Who owns the state
- Who can mutate it
- Who can read it
- How it is synchronized
- What happens when it becomes invalid

---

## Check Data Flow

Trace important flows end-to-end.

Examples:

- User input to game action
- Client request to server validation
- Server state change to network update
- Entity creation to entity destruction
- Save/load flow
- UI interaction to underlying system mutation
- Config loading to runtime behavior

Flag flows that are:

- Too indirect
- Poorly named
- Split across too many files
- Dependent on hidden side effects
- Missing validation
- Missing error handling
- Missing cleanup
- Duplicated in multiple places
- Impossible to understand without reading half the codebase

Good code should have understandable flow.

---

## Check Naming

Names should match reality.

Flag names that are:

- Too vague: `Manager`, `Helper`, `Util`, `Data`, `Info`, `Thing`
- Too grandiose for what they do
- Misleading about ownership or authority
- Using domain terms inconsistently
- Hiding side effects
- Claiming to validate/sanitize/secure something when they do not
- Using similar names for different concepts
- Using different names for the same concept

Good names reduce the need for comments.

---

## Check Types and Runtime Safety

For TypeScript projects, check that types are actually protecting the code.

Flag:

- Excessive `any`
- Unsafe type assertions
- Non-null assertions used to silence real uncertainty
- Runtime data trusted just because it has a TypeScript type
- External input not validated at runtime
- Types duplicated instead of shared
- Types that lie about optional fields
- Union types not exhaustively handled
- Incorrect generic abstractions
- Functions accepting huge vague objects
- Types so complex they hide the actual behavior

Remember:

> TypeScript types do not validate runtime data.

Network messages, user input, saved files, JSON, and external API responses need runtime validation if correctness matters.

---

## Check Error Handling

Look for bad error handling.

Flag:

- Empty `catch` blocks
- Logging an error but continuing as if everything is fine
- Throwing generic errors with no context
- Swallowing promise rejections
- Not awaiting async operations that matter
- Missing cleanup after failure
- Retrying forever
- Failing silently
- Returning `null` or `undefined` without clear meaning
- Mixing exceptions and result objects inconsistently

Good error handling should make failures visible, debuggable, and recoverable where appropriate.

---

## Check Async and Lifecycle Bugs

Look for:

- Race conditions
- Event listeners not removed
- Timers not cleared
- Intervals that continue after shutdown
- Promises that are not awaited
- Async initialization order problems
- Using objects before they are ready
- Double initialization
- Double cleanup
- Memory leaks from retained references
- Stale closures
- Reconnection logic that duplicates handlers

Every system that starts should have a clear stop/dispose/destroy path if it owns resources.

---

## Check Performance Sanity

Do not prematurely optimize, but flag obvious problems.

Look for:

- Expensive work done every frame/tick
- Unbounded loops over all entities/players/items
- Repeated allocations in hot paths
- Excessive JSON serialization
- Rebuilding large data structures unnecessarily
- Recomputing values that could be cached safely
- Sending too much data over the network
- Deep cloning large objects
- Excessive event fanout
- O(n²) behavior where n may grow large
- Memory growth with no cleanup
- Debug logging inside hot loops
- Bad practices in our realtime netcode that is meant to support 100+ players on one server with also 1000+ npcs, in other words it must be very scalable and performant and efficient

For real-time systems, be especially careful with per-tick and per-frame code.

---

## Check Dependencies

Inspect dependencies and imports.

Flag:

- Large dependency used for a tiny task
- Dependency that duplicates existing functionality
- Abandoned or unnecessary libraries
- Client bundle pulling in server-only packages
- Multiple libraries doing the same job
- Circular imports
- Import paths that bypass public APIs
- Deep imports into another system's internals
- Dependency direction violations

Prefer fewer dependencies when the code is simple enough to own directly.

---

## Check Tests and Verification

Look for whether important behavior can be verified.

Flag:

- Core logic with no tests
- Tests that only test mocks
- Tests that duplicate implementation details
- Tests with no assertions
- Snapshot tests that hide real behavior
- Tests that are disabled or skipped
- Tests that cannot run
- No typecheck script
- No lint script
- No build verification
- No smoke test for startup

When possible, run:

```bash
npm run typecheck
npm run lint
npm test
npm run build
```

If scripts do not exist, say so.

Do not assume the project is healthy unless verification passes.

---

## Check for Duplicated Systems

Look for multiple systems that appear to solve the same problem.

Examples:

- Two event buses
- Two entity registries
- Two config loaders
- Two networking abstractions
- Two logging systems
- Two validation systems
- Two command systems
- Two save/load systems
- Two lifecycle systems
- Two ways to create the same kind of object

Sometimes duplication is temporary or intentional, but it should be obvious why.

If not, recommend consolidation.

---

## Check for Dead Code

Look for:

- Unused files
- Unused exports
- Unused classes
- Unused functions
- Unused config
- Unreachable branches
- Old systems replaced by newer systems
- Commented-out code
- Feature flags that are always true or always false
- Test helpers no tests use
- Types no code references

Before deleting, verify usage with search.

---

## Check Configuration

Flag config problems:

- Magic numbers scattered across code
- Same constant defined in multiple places
- Environment variables read directly all over the codebase
- Missing defaults
- Missing validation
- Config names that do not match behavior
- Runtime config mixed with build config
- Secret values committed to source
- Dev-only settings leaking into production
- Production behavior depending on local machine assumptions

Config should be centralized enough to understand, but not over-abstracted.

---

## Check Security and Trust Boundaries

For any user input, network input, saved data, or external data, check:

- Is it validated?
- Is it sanitized?
- Is it authorized?
- Can a client lie?
- Can a malformed message crash the server?
- Can a user access another user's data?
- Can someone spam expensive operations?
- Can someone create infinite entities/items/messages?
- Are there rate limits where needed?
- Are IDs guessable when that matters?
- Are errors leaking sensitive details?

Never trust the client.

---

## Check Networked / Multiplayer Code

For multiplayer code, verify:

- The server is authoritative where it should be
- Clients cannot directly decide important game outcomes
- Client messages are validated
- Client messages are rate-limited where needed
- Only necessary data is synchronized
- Derived/client-inferable data is not spammed over the network
- Interest management exists where needed
- Entity creation/destruction is synchronized correctly
- Disconnect cleanup is handled
- Reconnect behavior is sane
- Prediction/reconciliation code is clearly separated from authoritative state
- Network schemas match actual runtime messages
- Bandwidth use is considered
- Server tick/update loops are not doing unnecessary work
- Per-player work scales acceptably

For a real-time game, avoid syncing everything just because it is convenient.

Ask:

> Does the client actually need this data, or can it infer/render it locally?

---

## Check Game/System Design Code

For game code, distinguish between:

- Simulation state
- Rendering state
- Input state
- Network state
- UI state
- Persistence state
- Temporary effects

Flag code that mixes these together without a good reason.

Examples of bad mixing:

- Rendering code mutating authoritative game state
- UI directly changing simulation internals
- Network packet handlers directly spawning complex objects without validation
- Game entities knowing too much about transport/network details
- Save/load code depending on rendering objects
- Effects/VFX treated as authoritative gameplay state

Prefer clean separation between simulation, presentation, networking, and persistence.

---

## Check ECS / Component-Like Systems

If the codebase uses entities/components/systems or similar architecture, check:

- Components are mostly data, not random behavior buckets
- Systems have clear responsibilities
- Entity lifecycle is clear
- Components are added/removed safely
- Systems do not secretly depend on execution order unless documented
- Queries are efficient enough
- There are no duplicate sources of truth
- Component names are consistent
- Systems do not mutate unrelated components casually
- Serialization of components is explicit and controlled

Flag component soup where everything depends on everything.

---

## Check API Design

For internal APIs, ask:

- Is this easy to call correctly?
- Is it hard to call incorrectly?
- Are required fields explicit?
- Are side effects obvious?
- Are errors clear?
- Is the return value meaningful?
- Does this expose too much internal detail?
- Does this force callers to know implementation details?
- Is the abstraction stable enough to deserve being an API?

Flag APIs that require the caller to perform fragile sequences manually.

Bad:

```ts
thing.init()
thing.setMode()
thing.attach()
thing.start()
thing.refresh()
```

Better, if possible:

```ts
createStartedThing(options)
```

or a clearly documented lifecycle.

---

## Check Comments and Documentation

Comments should explain why, not pretend the code works.

Flag comments that:

- Are outdated
- Contradict the code
- Describe what the code obviously does
- Claim future behavior that is not implemented
- Hide complexity instead of clarifying it
- Mark broken code as temporary with no plan
- Explain an abstraction that should instead be simplified

Good documentation should clarify architecture, ownership, invariants, and usage.

---

## Check File and Folder Structure

Flag structure problems:

- Files placed in misleading folders
- Folders organized by technical type when feature/domain organization would be clearer, or vice versa
- Huge folders with no clear boundaries
- Tiny folders with only one needless file each
- Index files that hide confusing exports
- Deep folder nesting with no benefit
- Public and private internals mixed together
- Naming inconsistency between folders and concepts

Folder structure should help navigation.

---

## Check Build and Tooling

Look for:

- Broken scripts
- Scripts that do not do what their names imply
- Missing typecheck
- Missing production build
- Missing clean command if needed
- Dev server requiring undocumented steps
- Generated files committed accidentally
- Build artifacts mixed with source
- Inconsistent module systems
- Path aliases that obscure actual dependencies
- Tooling config copied from somewhere but not appropriate

---

## Check for Overengineering

Flag overengineering when code has:

- Too many layers
- Too many abstractions
- Too many tiny files
- Too many interfaces
- Too many generic systems
- Too many configuration options
- Too much indirection
- Too much ceremony for simple behavior
- Abstractions created for imagined future needs
- Patterns copied from enterprise/backend code where simple game code would be better

Do not recommend abstracting unless there is a real repeated pattern or boundary.

Prefer:

```ts
function doThing() {}
```

over:

```ts
IThingOperationExecutorFactoryProvider
```

unless the complexity is genuinely needed.

---

## Check for Underengineering

Also flag code that is too ad hoc.

Look for:

- Giant files doing everything
- Copy-pasted logic
- No clear ownership
- No validation
- No lifecycle handling
- No cleanup
- No tests around critical logic
- Hardcoded behavior that should be data-driven
- Implicit contracts that are not enforced
- Important behavior hidden in random utility functions

The goal is not always less architecture.

The goal is the right amount of architecture.

---

## Check Invariants

Identify important rules the code assumes.

Examples:

- Every entity has a unique ID
- A player has exactly one active character
- A network entity must be registered before syncing
- A component must not exist without another component
- A system must run after another system
- A client message must refer to an owned entity
- A destroyed object must not receive updates

Then check whether the code actually enforces those rules.

Flag invariants that exist only in the programmer's imagination.

---

## Check Logging and Debugging

Look for:

- No logs around important failures
- Too much noisy logging
- Logs inside hot loops
- Logs with no context
- Errors logged without IDs or state
- Debug logs always enabled
- Console spam in production paths
- No way to trace important flows

Good logs should help debug real issues without overwhelming output.

---

## Check Cleanup and Resource Management

Flag:

- Event listeners not removed
- Entities not unregistered
- Network connections not cleaned up
- Timers not cleared
- Maps/Sets growing forever
- Object pools not reset correctly
- Subscriptions leaking
- Temporary effects never destroyed
- Disconnected players still referenced
- Destroyed objects still receiving updates

Every long-lived registry should have a removal path.

---

## Check for Hidden Coupling

Look for code that depends on:

- Specific execution order
- Global singletons
- Shared mutable objects
- Naming conventions not enforced anywhere
- Magic IDs
- Implicit initialization
- Side effects from imports
- Undocumented event names
- Stringly-typed commands
- Object shapes not validated
- External systems being present but not injected or passed explicitly

Hidden coupling makes code fragile.

---

## Check Feature Completeness

For each feature reviewed, ask:

- Is it actually wired into the app?
- Can it be triggered?
- Does it handle success?
- Does it handle failure?
- Does it clean up?
- Does it work after reload/restart if relevant?
- Is it tested?
- Is it documented?
- Is there dead scaffolding pretending to be implementation?

AI often creates scaffolding that looks complete but is not actually integrated.

---

## Check Consistency

Look for inconsistent patterns.

Examples:

- Some systems use events, others direct calls, without reason
- Some errors throw, others return results
- Some state is immutable, other state is mutated freely
- Some modules use classes, others functions, without reason
- Some features validate input, others trust it
- Some systems clean up, others leak
- Some network messages are schema-validated, others are not

Consistency matters because future code will copy existing patterns.

---

## Output Format for Sanity Check

When reporting findings, use this format:

```md
## Summary

Briefly describe the overall health of the codebase or area reviewed.

## Major Risks

List the most important issues first.

For each issue:

### Issue: [Name]

**Severity:** Critical / High / Medium / Low  
**Location:** File(s) and relevant functions/classes  
**Problem:** What is wrong  
**Why it matters:** Concrete consequences  
**Evidence:** What code proves this  
**Recommendation:** What should change  
**Suggested fix size:** Small / Medium / Large  

## Suspicious Code

List code that may not be wrong yet but deserves attention.

## Unnecessary Abstractions

List middlemen, wrappers, interfaces, managers, or services that may not justify their existence.

## Dead or Duplicate Code

List unused, duplicate, obsolete, or competing systems.

## Architecture Notes

Explain any boundary, ownership, or dependency problems.

## Quick Wins

Small changes that would improve the codebase quickly.

## Do Not Change Yet

Mention anything that looks questionable but should not be changed until more context is known.
```

---

## Rules for Making Changes

Do not make huge rewrites unless explicitly asked.

Prefer:

1. Understanding first
2. Reporting findings
3. Small safe fixes
4. Tests or verification
5. Larger refactors only after the problem is clear

Before changing code, identify:

- What behavior must stay the same
- What could break
- How to verify the change
- Whether the change simplifies or complicates the system

Never replace working understandable code with a fashionable pattern just because it looks more architectural.

---

## Red Flags That Deserve Extra Attention

Flag these aggressively:

- Code that compiles but is never used
- Systems with no clear owner
- Abstract classes or interfaces with one implementation
- Managers that only call other managers
- Event names as raw strings everywhere
- Global mutable registries
- Silent error handling
- Client-authoritative gameplay decisions
- Network messages without validation
- Massive files with unrelated responsibilities
- Tiny files that exist only to forward exports
- Circular dependencies
- Duplicate source of truth
- State mutation from many directions
- Runtime data trusted without validation
- Fake future-proofing
- Overly generic systems with no concrete use
- Comments claiming things not proven by code
- TODOs in critical paths
- Unbounded per-tick work
- Memory that only grows
- Disconnected players/entities/resources not cleaned up

---

## Guiding Principle

The best codebase is not the one with the most architecture.

The best codebase is the one where a competent programmer can answer these questions quickly:

- What does this do?
- Where is the state?
- Who owns the state?
- Who can change it?
- How does data flow?
- What happens when something fails?
- How do I verify it works?
- What can I safely change?

If the code makes these questions hard to answer, flag it.
