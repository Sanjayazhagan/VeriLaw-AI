from langgraph.graph import StateGraph, START, END
from state import LegalAuditState
from nodes import seed_node, worker_node, fan_out_to_workers, synthesizer_node

def create_audit_graph():
    builder = StateGraph(LegalAuditState)
    
    builder.add_node("seed_node", seed_node)
    builder.add_node("worker_node", worker_node)
    builder.add_node("synthesizer_node", synthesizer_node)

    builder.add_edge(START, "seed_node")
    builder.add_conditional_edges("seed_node", fan_out_to_workers)
    
    # All workers must finish before moving to the synthesizer
    builder.add_edge("worker_node", "synthesizer_node") 
    builder.add_edge("synthesizer_node", END) 

    return builder.compile()

compiled_graph = create_audit_graph()