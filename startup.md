# Phase 1 (Generating snapshot script)

* Start at the entry point, walking the dependencies graph
* Construct a script
  * Define a custom require:
    ```
    function customRequire (path) {
      if (map.has(path)) {
        return map[path](customRequire)
      } else {
        return global.require(path)
      }
    }
    ```
  * Generate a map of paths to functions
  * Call the entry point function passing the custom require

**Goal:** define a single script to run in `mksnapshot`

# Phase 2 (Running snapshot script)

* Call `mksnapshot` with the generated script

**Goal:** define an `atom` global

# Phase 3 (Atom Runtime)

* Call `atom.initialize()` which finalizes any DOM related setup

**Goal:** start Atom.app
