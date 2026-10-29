name: Feature request
description: Suggest a new capability or improvement
labels: [enhancement]
body:
  - type: textarea
    id: problem
    attributes:
      label: What problem does this solve?
      description: Describe the pain point before proposing the solution.
    validations:
      required: true
  - type: textarea
    id: solution
    attributes:
      label: What would you like to see?
      description: |
        Ideas that fit this project especially well: new analysis pipeline
        stages, new report sections, strategy rule types for the risk gate,
        LLM provider support in agent/, self-hosting improvements.
    validations:
      required: true
  - type: textarea
    id: alternatives
    attributes:
      label: Alternatives you have considered
