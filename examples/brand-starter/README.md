# Brand starter example

This directory is an example of the output from the external brand authoring
tool. `northstar/` is a neutral, synthetic brand; it is not a customer brand.

Create the same shape somewhere else with:

```bash
node scripts/brand-tool.js init \
  --out ./my-brands \
  --brand acme \
  --name "Acme" \
  --preset starter
```

Then use the generated loop:

```bash
node scripts/brand-tool.js validate \
  --brand-root ./my-brands \
  --brand brand://acme/primary

node scripts/brand-tool.js preview \
  --kind showcase \
  --brand-root ./my-brands \
  --brand brand://acme/primary \
  --out ./prototype/acme \
  --formats pdf,png,pptx
```

For a small token change in an existing profile:

```bash
node scripts/brand-tool.js set \
  --brand-root ./my-brands \
  --brand brand://acme/primary \
  --path layout.title_align \
  --value center
```

The generated `northstar/generated/` directory is a checked example of the
result: a report, an editable PPTX, a PDF and PNG slides. Edit the source
brandbook, render again and inspect the output before publishing it for MCP.
