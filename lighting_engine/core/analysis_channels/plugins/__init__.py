"""Plugin analysis channels — optional, non-blocking, environment-detected.

Each plugin module exposes a `probe()` function that returns a dict
describing the plugin's installed/built/available status and resource
requirements. Modules must NOT import heavy dependencies at module level;
only probe() should attempt conditional imports.
"""
