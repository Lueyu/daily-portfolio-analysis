name: Bug report
description: Something is broken or behaves unexpectedly
labels: [bug]
body:
  - type: markdown
    attributes:
      value: |
        Thanks for taking the time to report! If you can, reproduce with the
        Docker demo first (`docker compose up --build`) — it rules out
        environment issues.
  - type: textarea
    id: what-happened
    attributes:
      label: What happened?
      description: A clear description of the bug, plus what you expected instead.
    validations:
      required: true
  - type: textarea
    id: reproduce
    attributes:
      label: Steps to reproduce
      placeholder: |
        1. Start with `docker compose up --build`
        2. Open http://localhost:3000/...
        3. ...
    validations:
      required: true
  - type: dropdown
    id: mode
    attributes:
      label: How are you running the app?
      options:
        - Docker demo (docker compose)
        - Official cloud mode (npm run dev)
        - Full offline mode (dev-local-full.ps1)
        - Building from source
    validations:
      required: true
  - type: textarea
    id: logs
    attributes:
      label: Relevant logs / screenshots
      render: shell
