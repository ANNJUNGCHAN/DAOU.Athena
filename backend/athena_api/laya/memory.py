"""Classify extracted targets using their original conversation, before projection."""
from copy import deepcopy


async def refine_extraction(source, envelope, client):
    entities, relations = list(envelope.entities), list(envelope.relations)
    requests = [{"task_id": "memory.entity_kind", "utterance": source.text,
                 "context": {"entity_mention": item.name}} for item in entities]

    async def classify(rows):
        result = []
        for offset in range(0, len(rows), 32):
            result.extend(await client.decide(rows[offset:offset + 32]))
        return result

    for index, result in enumerate(await classify(requests)):
        if result["accepted"]:
            data = entities[index].model_dump()
            data["kind"] = result["label"]
            entities[index] = type(entities[index]).model_validate(data)
    names = {item.ref: item.name for item in entities}
    names["me"] = "사용자 본인"
    targets = [{"subject": names.get(item.source_ref, item.source_ref),
                "target": names.get(item.target_ref, item.target_ref)} for item in relations]
    requests = [{"task_id": "memory.relation_kind", "utterance": source.text,
                 "context": {**target, "relation_candidate": {**target, "predicate": str(item.kind)}}}
                for target, item in zip(targets, relations, strict=True)]
    for index, result in enumerate(await classify(requests)):
        if result["accepted"]:
            data = relations[index].model_dump()
            data["kind"] = result["label"]
            relations[index] = type(relations[index]).model_validate(data)
    requests = [{"task_id": "memory.explicitness", "utterance": source.text,
                 "context": {"relation_candidate": {**target, "predicate": str(item.kind)}}}
                for target, item in zip(targets, relations, strict=True)]
    for index, result in enumerate(await classify(requests)):
        if result["accepted"]:
            data = relations[index].model_dump()
            data["confidence"] = result["label"]
            relations[index] = type(relations[index]).model_validate(data)
    # Preserve references, timestamps, source binding, attributes and rationale.
    # Tier/IDs are still constructed and validated by the original projection code.
    data = deepcopy(envelope.model_dump())
    data.update(entities=[item.model_dump() for item in entities],
                relations=[item.model_dump() for item in relations])
    return type(envelope).model_validate(data)
