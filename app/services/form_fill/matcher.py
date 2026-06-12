"""表單模板匹配與套用邏輯"""
import copy
from collections import defaultdict


def match_new_fields_with_template(
    new_fields: list[dict],
    template_fields: list[dict],
    template_values: dict
) -> tuple[list[dict], dict]:
    """
    將新偵測到的欄位與模板欄位進行配對。
    
    配對邏輯：
    1. 優先根據 label + page 進行完全匹配。
    2. 如果有多個同 label 且同 page 的欄位，按照空間幾何順序（由上至下、由左至右）依次配對。
    3. 對於未能通過標籤匹配的欄位，按照空間幾何順序（由上至下、由左至右）依次進行位置兜底配對。
    4. 配對成功的欄位，其 bbox、label、field_type、semantic_key 將套用模板中的設定。
    5. 回傳更新後的新欄位列表以及對應的建議填寫值字典。
    """
    def get_sort_key(f):
        bbox = f.get("bbox")
        if bbox:
            # PDF 座標 y 軸起點在左下角，所以由上至下排序意味著 y 坐標 (bbox[3]) 遞減。
            return (f.get("page", 0), -bbox[3], bbox[0])
        return (f.get("page", 0), float('inf'), float('inf'))

    new_fields = copy.deepcopy(new_fields)
    template_fields = copy.deepcopy(template_fields)

    new_sorted = sorted(new_fields, key=get_sort_key)
    tmpl_sorted = sorted(template_fields, key=get_sort_key)

    mapped_values = {}
    matched_new_names = set()
    matched_tmpl_names = set()

    # 1. 進行 label 完全匹配
    new_groups = defaultdict(list)
    for f in new_sorted:
        label = (f.get("label") or "").strip()
        page = f.get("page", 0)
        new_groups[(page, label)].append(f)

    tmpl_groups = defaultdict(list)
    for f in tmpl_sorted:
        label = (f.get("label") or "").strip()
        page = f.get("page", 0)
        tmpl_groups[(page, label)].append(f)

    for (page, label), tmpl_list in tmpl_groups.items():
        if not label:  # 留待位置兜底匹配
            continue
        new_list = new_groups.get((page, label))
        if new_list:
            for nf, tf in zip(new_list, tmpl_list):
                if tf.get("bbox"):
                    nf["bbox"] = tf["bbox"]
                if tf.get("field_type"):
                    nf["field_type"] = tf["field_type"]
                if tf.get("semantic_key"):
                    nf["semantic_key"] = tf["semantic_key"]
                
                val = template_values.get(tf["name"])
                if val is not None:
                    mapped_values[nf["name"]] = val
                    nf["suggested_value"] = val
                
                matched_new_names.add(nf["name"])
                matched_tmpl_names.add(tf["name"])

    # 2. 處理 label 為空或未能匹配的欄位，依據排序位置進行兜底配對
    remaining_new = [f for f in new_sorted if f["name"] not in matched_new_names]
    remaining_tmpl = [f for f in tmpl_sorted if f["name"] not in matched_tmpl_names]

    for nf, tf in zip(remaining_new, remaining_tmpl):
        if tf.get("bbox"):
            nf["bbox"] = tf["bbox"]
        if tf.get("field_type"):
            nf["field_type"] = tf["field_type"]
        if tf.get("semantic_key"):
            nf["semantic_key"] = tf["semantic_key"]
        if tf.get("label") and not nf.get("label"):
            nf["label"] = tf["label"]
        
        val = template_values.get(tf["name"])
        if val is not None:
            mapped_values[nf["name"]] = val
            nf["suggested_value"] = val

    return new_fields, mapped_values
