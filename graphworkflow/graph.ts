import { END, START, StateGraph } from "@langchain/langgraph";
import { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { openaiStructured, StructuredModel } from "./common/model";
import { PlannerState, StageReporter } from "./common/state";
import { REGIONS } from "./common/types";
import { prepareNode } from "./nodes/prepare_node";
import { regionNode } from "./nodes/region_node";
import { nutritionNode } from "./nodes/nutrition_node";
import { validationNode, assembleNode } from "./nodes/validation_node";
import { weekReviewNode } from "./nodes/week_review_node";

type GraphOptions = {
  model?: StructuredModel;
  checkpointer?: BaseCheckpointSaver;
  stage?: StageReporter;
};

export function buildWeeklyGraph(options: GraphOptions = {}) {
  const model = options.model ?? openaiStructured;

  const reportStage = options.stage ?? (async () => {});

  const graph = new StateGraph(PlannerState)
    .addNode("prepare", (state) => prepareNode(state, reportStage))
    .addNode("assemble", (state) => assembleNode(state, reportStage))
    .addNode("review", (state) => weekReviewNode(state, model, reportStage))
    .addNode("nutrition", (state) => nutritionNode(state, model, reportStage))
    .addNode("validate", (state) => validationNode(state, reportStage, model));

  for (const region of REGIONS) {
    graph.addNode(region, regionNode(region, model, reportStage));
  }

  graph.addEdge(START, "prepare");

  for (const region of REGIONS) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    graph.addEdge("prepare", region as any);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  graph.addEdge([...REGIONS] as any, "assemble");
  graph.addEdge("assemble", "review");
  graph.addEdge("review", "nutrition");
  graph.addEdge("nutrition", "validate");
  graph.addEdge("validate", END);

  return graph.compile({ checkpointer: options.checkpointer });
}
