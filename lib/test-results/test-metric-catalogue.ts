// SPDX-License-Identifier: AGPL-3.0-only

import type Database from "better-sqlite3-multiple-ciphers"

/**
 * Curated first-pass test-metric catalogue (ADR-0019): numeric metrics of a typical GP request.
 * One default SI unit per metric (the unit the owner's laboratories print), editable per result,
 * never converted. US names and abbreviations are aliases. Panel is a label for telling similar
 * metrics apart, not navigation. Existing names are never renamed (results store the name as text).
 * Units not verified against a primary source are marked and confirmed when a release revisits the list.
 */
export interface TestMetricCatalogueEntry {
  name: string
  unit: string | null
  panel: string
  valueType: "numeric" | "qualitative"
  aliases: string[]
}

const FBC = "Full blood count"
const UE = "Urea & electrolytes"
const LFT = "Liver function"
const BONE = "Bone profile"
const LIPIDS = "Lipids"
const TFT = "Thyroid function"
const IRON = "Iron, B12 & folate"
const DIABETES = "Diabetes & glucose"
const VITD = "Vitamin D"
const INFLAM = "Inflammation"
const URINE = "Urine"
const RAPID = "Rapid tests"

function n(name: string, unit: string | null, panel: string, aliases: string[] = []): TestMetricCatalogueEntry {
  return { name, unit, panel, valueType: "numeric", aliases }
}

function q(name: string, panel: string, aliases: string[] = []): TestMetricCatalogueEntry {
  return { name, unit: null, panel, valueType: "qualitative", aliases }
}

export const TEST_METRIC_CATALOGUE: TestMetricCatalogueEntry[] = [
  // Original ten keep their names and relative order.
  n("Haemoglobin", "g/L", FBC, ["Hb", "HGB", "Hemoglobin"]),
  n("White Cell Count", "x10^9/L", FBC, ["WCC", "WBC", "White blood cell count", "Leukocytes"]),
  n("Platelet Count", "x10^9/L", FBC, ["Plt", "PLT", "Platelets"]),
  n("C-Reactive Protein", "mg/L", INFLAM, ["CRP"]),
  n("Sodium", "mmol/L", UE, ["Na"]),
  n("Potassium", "mmol/L", UE, ["K", "Pot."]),
  n("Creatinine", "µmol/L", UE, ["Creat", "Creat.", "Creatinine (serum)"]),
  n("Glucose (fasting)", "mmol/L", DIABETES, ["Fasting glucose", "Fasting plasma glucose", "FPG", "FBG"]),
  q("COVID-19 RAT", RAPID, ["COVID", "COVID-19", "COVID rapid antigen test", "SARS-CoV-2 RAT"]),
  q("Strep A", RAPID, ["Group A strep", "Strep A rapid test", "GAS"]),

  n("Red Cell Count", "x10^12/L", FBC, ["RBC", "RCC", "Red blood cell count"]),
  n("Haematocrit", "L/L", FBC, ["Hct", "PCV", "Hematocrit", "Packed cell volume"]),
  n("Mean Cell Volume", "fL", FBC, ["MCV", "Mean corpuscular volume"]),
  n("Mean Cell Haemoglobin", "pg", FBC, ["MCH", "Mean corpuscular haemoglobin"]),
  n("Mean Cell Haemoglobin Concentration", "g/L", FBC, ["MCHC"]),
  n("Red Cell Distribution Width", "%", FBC, ["RDW"]),
  n("Neutrophils", "x10^9/L", FBC, ["Neut", "Neuts"]),
  n("Lymphocytes", "x10^9/L", FBC, ["Lymph", "Lymphs"]),
  n("Monocytes", "x10^9/L", FBC, ["Mono", "Monos"]),
  n("Eosinophils", "x10^9/L", FBC, ["Eos"]),
  n("Basophils", "x10^9/L", FBC, ["Baso", "Basos"]),
  n("Mean Platelet Volume", "fL", FBC, ["MPV"]),

  n("Chloride", "mmol/L", UE, ["Cl"]),
  n("Bicarbonate", "mmol/L", UE, ["Bicarb", "HCO3", "Total CO2", "Carbon dioxide"]),
  n("Urea", "mmol/L", UE, ["BUN", "Blood urea nitrogen", "Urea nitrogen"]),
  n("eGFR", "mL/min/1.73m²", UE, ["Estimated GFR", "Estimated glomerular filtration rate", "GFR"]),
  n("Anion Gap", "mmol/L", UE, ["AG"]),

  n("Alanine Aminotransferase", "U/L", LFT, ["ALT", "SGPT"]),
  n("Aspartate Aminotransferase", "U/L", LFT, ["AST", "SGOT"]),
  n("Alkaline Phosphatase", "U/L", LFT, ["ALP", "Alk Phos", "Alk. Phos."]),
  n("Gamma-Glutamyl Transferase", "U/L", LFT, ["GGT", "Gamma GT"]),
  n("Bilirubin (total)", "µmol/L", LFT, ["Total bilirubin", "Bilirubin", "Bili"]),
  n("Albumin", "g/L", LFT, ["Alb"]),
  n("Total Protein", "g/L", LFT, ["TP", "Protein (total)"]),
  n("Globulin", "g/L", LFT, ["Globulins"]),
  n("Lactate Dehydrogenase", "U/L", LFT, ["LDH", "LD", "Lactic dehydrogenase"]),

  n("Calcium (total)", "mmol/L", BONE, ["Calcium", "Ca", "Corrected calcium", "Adjusted calcium"]),
  n("Phosphate", "mmol/L", BONE, ["Phosphorus", "PO4", "Phos"]),
  n("Magnesium", "mmol/L", BONE, ["Mg"]),
  n("Urate", "mmol/L", BONE, ["Uric acid"]),
  n("Ionised Calcium", "mmol/L", BONE, ["Ionized calcium", "iCa", "Calcium (ionised)", "Calcium (ionized)"]),

  n("Total Cholesterol", "mmol/L", LIPIDS, ["Cholesterol", "TC", "Chol"]),
  n("HDL Cholesterol", "mmol/L", LIPIDS, ["HDL", "HDL-C"]),
  n("LDL Cholesterol", "mmol/L", LIPIDS, ["LDL", "LDL-C", "LDL cholesterol (calculated)"]),
  n("Non-HDL Cholesterol", "mmol/L", LIPIDS, ["Non-HDL", "non-HDL-C"]),
  n("Triglycerides", "mmol/L", LIPIDS, ["TG", "Trigs", "Trigly", "Triglyceride"]),
  n("Cholesterol/HDL Ratio", null, LIPIDS, ["TC:HDL", "Total cholesterol/HDL ratio", "Chol/HDL"]),

  n("Thyroid Stimulating Hormone", "mU/L", TFT, ["TSH", "Thyrotropin"]),
  n("Free Thyroxine", "pmol/L", TFT, ["FT4", "fT4", "Free T4"]),
  n("Free Tri-iodothyronine", "pmol/L", TFT, ["FT3", "fT3", "Free T3"]),

  n("Ferritin", "µg/L", IRON, ["Serum ferritin"]),
  n("Iron", "µmol/L", IRON, ["Serum iron", "Fe"]),
  n("Total Iron Binding Capacity", "µmol/L", IRON, ["TIBC"]),
  n("Transferrin", "g/L", IRON, ["Tf"]),
  n("Transferrin Saturation", "%", IRON, ["TSAT", "Tsat", "Iron saturation"]),
  n("Vitamin B12", "pmol/L", IRON, ["B12", "Cobalamin", "Serum B12"]),
  n("Folate", "nmol/L", IRON, ["Serum folate", "Folic acid"]),

  n("HbA1c (mmol/mol)", "mmol/mol", DIABETES, ["HbA1c", "A1c", "A1C", "Glycated haemoglobin", "Haemoglobin A1c"]),
  n("HbA1c (%)", "%", DIABETES, ["HbA1c", "A1c", "A1C", "Glycated haemoglobin", "Hemoglobin A1c"]),
  n("Glucose (random)", "mmol/L", DIABETES, ["Random glucose", "Random blood glucose", "RBG"]),

  n("25-Hydroxyvitamin D", "nmol/L", VITD, ["Vitamin D", "25-OH vitamin D", "25(OH)D", "Calcidiol", "25-hydroxy Vitamin D3", "Vitamin D3"]),

  n("Erythrocyte Sedimentation Rate", "mm/h", INFLAM, ["ESR"]),
  n("Urine Albumin/Creatinine Ratio", "mg/mmol", URINE, ["ACR", "uACR", "Albumin:creatinine ratio"]),
]

/**
 * Upserts the curated catalogue into `test_metric_config`. Name, alias, panel, value type and
 * sort order are release-owned and refreshed; `unit` and `is_active` are only set on insert, so
 * a manager's hide/show toggle survives. Requires the 023 columns.
 */
export function syncTestMetricCatalogue(db: Database.Database): void {
  const upsert = db.prepare(
    `INSERT INTO test_metric_config (metric_name, unit, sort_order, aliases, panel, value_type)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(metric_name) DO UPDATE SET
       sort_order = excluded.sort_order,
       aliases    = excluded.aliases,
       panel      = excluded.panel,
       value_type = excluded.value_type`,
  )
  db.transaction(() => {
    TEST_METRIC_CATALOGUE.forEach((m, i) => {
      upsert.run(m.name, m.unit, i + 1, JSON.stringify(m.aliases), m.panel, m.valueType)
    })
  })()
}
