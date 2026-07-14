import type {
  AddCaseInput,
  AddDatasetInput,
  AppState,
  CaseEditInput,
  ConversationId,
  CriterionEditInput,
  CriterionInput,
  DeleteCaseOptions,
  DeleteDatasetOptions,
  EvalCase,
  EvalCaseId,
  EvalDatasetId,
  MutationResult,
  RenameDatasetInput,
} from "./types";
import {
  cloneState,
  err,
  findCaseInState,
  findDataset,
  nextId,
  ok,
  slugify,
  trimOrEmpty,
  updateDataset,
} from "./shared";
import {
  defaultCriteriaForType,
  hitlImportAvailability,
  inferCaseType,
} from "./eval-support";

export function importHitlFromConversation(
  state: AppState,
  conversationId: ConversationId,
): MutationResult {
  const conversation = state.conversations.find((item) => item.id === conversationId);
  if (!conversation) {
    return err(state, "Conversation not found");
  }
  const dataset = state.evalDatasets.find((item) => item.id === state.selections.evalDatasetId) ??
    state.evalDatasets.find((item) => item.protected);

  if (!dataset) {
    return err(state, "Dataset not found");
  }

  const availability = hitlImportAvailability(conversation, dataset);
  if (availability.status === "unresolved") {
    return err(state, "Resolve the conversation before importing it");
  }
  if (availability.status === "no_staff_reply") {
    return err(state, "Resolved conversation has no staff reply to import");
  }
  if (availability.status === "already_imported") {
    return err(state, "Conversation already imported into this dataset");
  }

  const { inputMessages, staff } = availability;
  const type = inferCaseType(conversation);
  const caseId = nextId("case-hitl", dataset.cases.map((item) => item.id));
  const language = staff.language ?? conversation.patient.preferredLanguage;
  const evalCase: EvalCase = {
    id: caseId,
    title: `HITL ${conversation.patient.name}`,
    split: "train",
    type,
    language,
    inputConversation: { messages: inputMessages },
    expectedHumanOutput: staff.text,
    criterionIds: defaultCriteriaForType(type, dataset.criteria),
    source: {
      kind: "hitl",
      conversationId: conversation.id,
      messageIds: [...inputMessages.map((message) => message.id), staff.id],
    },
    sourceConversationId: conversation.id,
  };

  const next = updateDataset(state, dataset.id, (current) => ({
    ...current,
    cases: [...current.cases, evalCase],
  }));
  return ok(next);
}

export function importHitlConversations(
  state: AppState,
  conversationIds: ConversationId[],
): MutationResult {
  const uniqueIds = [...new Set(conversationIds)];
  if (uniqueIds.length === 0) {
    return err(state, "Select at least one resolved conversation");
  }

  let next = state;
  for (const conversationId of uniqueIds) {
    const result = importHitlFromConversation(next, conversationId);
    if (!result.ok) {
      return err(state, result.error);
    }
    next = result.state;
  }
  return ok(next);
}

export function addDataset(state: AppState, input: AddDatasetInput): MutationResult {
  const name = trimOrEmpty(input.name);
  if (!name) {
    return err(state, "Dataset name cannot be empty");
  }
  if (state.evalDatasets.some((dataset) => dataset.name.toLowerCase() === name.toLowerCase())) {
    return err(state, "Dataset name must be unique");
  }

  const baseId = `dataset-${slugify(name)}`;
  const existingIds = state.evalDatasets.map((dataset) => dataset.id);
  const id = existingIds.includes(baseId) ? nextId(baseId, existingIds) : baseId;
  const dataset = {
    id,
    name,
    protected: false,
    candidateVersion: 1,
    criteria: [],
    cases: [],
    suiteSnapshots: [],
    runHistory: [],
  };
  const next: AppState = {
    ...cloneState(state),
    evalDatasets: [...state.evalDatasets, dataset],
    selections: { ...state.selections, evalDatasetId: id },
  };
  return ok(next);
}

export function renameDataset(state: AppState, input: RenameDatasetInput): MutationResult {
  const dataset = findDataset(state, input.datasetId);
  if (!dataset) {
    return err(state, "Dataset not found");
  }
  const name = trimOrEmpty(input.name);
  if (!name) {
    return err(state, "Dataset name cannot be empty");
  }
  if (state.evalDatasets.some((item) => item.id !== input.datasetId && item.name.toLowerCase() === name.toLowerCase())) {
    return err(state, "Dataset name must be unique");
  }

  const next = updateDataset(state, input.datasetId, (current) => ({ ...current, name }));
  return ok(next);
}

export function deleteDataset(state: AppState, options: DeleteDatasetOptions): MutationResult {
  const dataset = findDataset(state, options.datasetId);
  if (!dataset) {
    return err(state, "Dataset not found");
  }
  if (!options.confirmed) {
    return err(state, "Delete dataset requires confirmation");
  }
  if (state.evalDatasets.length <= 1) {
    if (dataset.protected) {
      return err(state, "Cannot delete the only remaining protected seed dataset");
    }
    return err(state, "Cannot delete the only remaining dataset");
  }
  if (dataset.protected) {
    return err(state, "Protected seed dataset cannot be deleted");
  }

  const nextDatasets = state.evalDatasets.filter((item) => item.id !== options.datasetId);
  const next: AppState = {
    ...cloneState(state),
    evalDatasets: nextDatasets,
    selections: {
      ...state.selections,
      evalDatasetId: nextDatasets[0]?.id ?? null,
    },
  };
  return ok(next);
}

export function addCriterion(
  state: AppState,
  datasetId: EvalDatasetId,
  input: CriterionInput,
): MutationResult {
  const dataset = findDataset(state, datasetId);
  if (!dataset) {
    return err(state, "Dataset not found");
  }
  const label = trimOrEmpty(input.label);
  const instruction = trimOrEmpty(input.instruction);
  if (!label || !instruction) {
    return err(state, "Rubric name and instruction cannot be empty");
  }
  const examples = {
    good: input.examples?.good ? trimOrEmpty(input.examples.good) : undefined,
    bad: input.examples?.bad ? trimOrEmpty(input.examples.bad) : undefined,
  };

  const id = nextId("crit", dataset.criteria.map((item) => item.id));
  const next = updateDataset(state, datasetId, (current) => ({
    ...current,
    criteria: [
      ...current.criteria,
      {
        id,
        label,
        instruction,
        required: input.required,
        caseTypes: input.caseTypes,
        examples: examples.good || examples.bad ? examples : undefined,
        version: 1,
      },
    ],
  }));
  return ok(next);
}

export function editCriterion(
  state: AppState,
  criterionId: string,
  input: CriterionEditInput,
): MutationResult {
  const dataset = state.evalDatasets.find((item) => item.criteria.some((criterion) => criterion.id === criterionId));
  if (!dataset) {
    return err(state, "Criterion not found");
  }

  const current = dataset.criteria.find((item) => item.id === criterionId);
  if (!current) {
    return err(state, "Criterion not found");
  }
  const label = input.label === undefined ? current.label : trimOrEmpty(input.label);
  const instruction =
    input.instruction === undefined ? current.instruction : trimOrEmpty(input.instruction);
  if (!label || !instruction) {
    return err(state, "Rubric name and instruction cannot be empty");
  }
  const examples =
    input.examples === undefined
      ? current.examples
      : {
          good: input.examples.good ? trimOrEmpty(input.examples.good) : undefined,
          bad: input.examples.bad ? trimOrEmpty(input.examples.bad) : undefined,
        };
  const required = input.required ?? current.required;
  const caseTypes = input.caseTypes ?? current.caseTypes;
  const normalizedExamples = examples?.good || examples?.bad ? examples : undefined;
  const semanticChanged =
    instruction !== current.instruction ||
    required !== current.required ||
    JSON.stringify(caseTypes) !== JSON.stringify(current.caseTypes) ||
    JSON.stringify(normalizedExamples) !== JSON.stringify(current.examples);

  const next = updateDataset(state, dataset.id, (valueDataset) => ({
    ...valueDataset,
    criteria: valueDataset.criteria.map((criterion) =>
      criterion.id === criterionId
        ? {
            ...criterion,
            label,
            instruction,
            required,
            caseTypes,
            examples: normalizedExamples,
            version: semanticChanged ? criterion.version + 1 : criterion.version,
          }
        : criterion,
    ),
  }));
  return ok(next);
}

export function deleteCriterion(state: AppState, criterionId: string): MutationResult {
  const dataset = state.evalDatasets.find((item) => item.criteria.some((criterion) => criterion.id === criterionId));
  if (!dataset) {
    return err(state, "Criterion not found");
  }
  const inUse = dataset.cases.some((evalCase) => evalCase.criterionIds.includes(criterionId));
  if (inUse) {
    return err(state, "Criterion is referenced by a case");
  }

  const next = updateDataset(state, dataset.id, (current) => ({
    ...current,
    criteria: current.criteria.filter((criterion) => criterion.id !== criterionId),
  }));
  return ok(next);
}

export function addCase(state: AppState, input: AddCaseInput): MutationResult {
  const dataset = findDataset(state, input.datasetId);
  if (!dataset) {
    return err(state, "Dataset not found");
  }

  const title = trimOrEmpty(input.title);
  const language = trimOrEmpty(input.language);
  const expectedHumanOutput = trimOrEmpty(input.expectedHumanOutput);
  if (!title || !expectedHumanOutput) {
    return err(state, "Case title and expected output cannot be empty");
  }
  if (!language) {
    return err(state, "Case language cannot be empty");
  }
  if (input.inputConversation.messages.length === 0) {
    return err(state, "Case input conversation cannot be empty");
  }

  const invalidCriterion = input.criterionIds.find(
    (criterionId) => !dataset.criteria.some((criterion) => criterion.id === criterionId),
  );
  if (invalidCriterion) {
    return err(state, "Case criterion is invalid for dataset");
  }

  const id = nextId("case", dataset.cases.map((item) => item.id));
  const evalCase: EvalCase = {
    id,
    title,
    split: input.split,
    type: input.type,
    language,
    inputConversation: input.inputConversation,
    expectedHumanOutput,
    criterionIds: input.criterionIds,
    source: { kind: "manual" },
  };

  const next = updateDataset(state, input.datasetId, (current) => ({
    ...current,
    cases: [...current.cases, evalCase],
  }));
  return ok(next);
}

export function editCase(state: AppState, caseId: EvalCaseId, input: CaseEditInput): MutationResult {
  const located = findCaseInState(state, caseId);
  if (!located) {
    return err(state, "Case not found");
  }

  const { evalCase, dataset } = located;
  const title = input.title === undefined ? evalCase.title : trimOrEmpty(input.title);
  const language = input.language === undefined ? evalCase.language : trimOrEmpty(input.language);
  const expectedHumanOutput =
    input.expectedHumanOutput === undefined
      ? evalCase.expectedHumanOutput
      : trimOrEmpty(input.expectedHumanOutput);

  if (!title || !language || !expectedHumanOutput) {
    return err(state, "Case editable strings cannot be empty");
  }

  const criterionIds = input.criterionIds ?? evalCase.criterionIds;
  const invalidCriterion = criterionIds.find(
    (criterionId) => !dataset.criteria.some((criterion) => criterion.id === criterionId),
  );
  if (invalidCriterion) {
    return err(state, "Case criterion is invalid for dataset");
  }
  const split = input.split ?? evalCase.split;
  const type = input.type ?? evalCase.type;
  const definitionChanged =
    title !== evalCase.title ||
    split !== evalCase.split ||
    type !== evalCase.type ||
    language !== evalCase.language ||
    expectedHumanOutput !== evalCase.expectedHumanOutput ||
    criterionIds.join("\u0000") !== evalCase.criterionIds.join("\u0000");

  const next = updateDataset(state, dataset.id, (valueDataset) => ({
    ...valueDataset,
    cases: valueDataset.cases.map((currentCase) => {
      if (currentCase.id !== caseId) {
        return currentCase;
      }
      return {
        ...currentCase,
        title,
        split,
        type,
        language,
        expectedHumanOutput,
        criterionIds,
        actualSyntheticOutput: definitionChanged ? undefined : currentCase.actualSyntheticOutput,
        grade: definitionChanged ? undefined : currentCase.grade,
      };
    }),
  }));
  return ok(next);
}

export function duplicateCase(state: AppState, caseId: EvalCaseId): MutationResult {
  const located = findCaseInState(state, caseId);
  if (!located) {
    return err(state, "Case not found");
  }

  const id = nextId("case", located.dataset.cases.map((item) => item.id));
  const copy: EvalCase = {
    ...located.evalCase,
    id,
    source: { kind: "manual" },
    actualSyntheticOutput: undefined,
    grade: undefined,
  };

  const next = updateDataset(state, located.dataset.id, (dataset) => ({
    ...dataset,
    cases: [...dataset.cases, copy],
  }));
  return ok(next);
}

export function deleteCase(state: AppState, caseId: EvalCaseId, options: DeleteCaseOptions): MutationResult {
  const located = findCaseInState(state, caseId);
  if (!located) {
    return err(state, "Case not found");
  }
  if (!options.confirmed) {
    return err(
      state,
      "Delete case requires confirmation and removes run history plus pending corrections",
    );
  }

  let next = updateDataset(state, located.dataset.id, (dataset) => ({
    ...dataset,
    cases: dataset.cases.filter((evalCase) => evalCase.id !== caseId),
    runHistory: dataset.runHistory.filter((row) => row.caseId !== caseId),
  }));
  next = {
    ...next,
    corrections: next.corrections
      .filter((correction) => !(correction.sourceCaseId === caseId && correction.status === "pending"))
      .map((correction) =>
        correction.sourceCaseId === caseId
          ? { ...correction, sourceCaseId: undefined }
          : correction,
      ),
  };
  return ok(next);
}
