# CI Setup

The GitHub Actions workflow in `.github/workflows/ci.yml` does not require any
GitHub secrets. It runs linting, typechecking, unit tests, and builds using the
repo's default scripts.

If future CI steps need external provider access (for example, OpenAI or
ElevenLabs), add the required secrets in the repo settings and document them
here.
