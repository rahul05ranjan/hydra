"""Berkeley Function Calling Leaderboard (bfcl-eval) for Qwen3.5-family models: base Qwen3.5-0.8B
and Hydra Nano, served by llama.cpp's OpenAI-compatible server.

bfcl-eval ships no Qwen3.5 handler. Its Qwen3 handler writes Qwen3's JSON tool-call prompt, but
Qwen3.5's own chat template asks for XML calls (<function=name><parameter=key>value</parameter>).
This handler prompts with the model's own template (tools passed in, thinking off, as Hydra runs)
and converts each XML call to the Qwen3 JSON form, typing parameter values by the function schema,
so bfcl-eval's unmodified decoder and checker score it.

Usage (a llama.cpp server for the model must already be listening on LOCAL_SERVER_PORT):
  BFCL_PROJECT_ROOT=<dir> LOCAL_SERVER_PORT=<port> python evals/public/bfcl_qwen35.py \
    generate --model hydra-nano-v2-FC --local-model-path <hf dir> --skip-server-setup --test-category ...
  BFCL_PROJECT_ROOT=<dir> python evals/public/bfcl_qwen35.py evaluate --model hydra-nano-v2-FC ...
"""
import ast
import json
import re
from typing import Any

from bfcl_eval.__main__ import cli
from bfcl_eval.constants.model_config import MODEL_CONFIG_MAPPING, ModelConfig
from bfcl_eval.model_handler.local_inference.qwen_fc import QwenFCHandler
from overrides import override

# A value ends at its closing tag or, when the model leaves that out, where the next one starts, as
# Qwen's own XML tool parser reads it.
CALL = re.compile(r"<tool_call>\s*<function=([^>\n]+)>(.*?)(?:</function>|</tool_call>|(?=<tool_call>)|\Z)", re.DOTALL)
PARAMETER = re.compile(r"<parameter=([^>\n]+)>\n?(.*?)\n?(?:</parameter>|(?=<parameter=)|\Z)", re.DOTALL)


def _literal(text: str) -> Any:
    try:
        return json.loads(text)
    except ValueError:
        return ast.literal_eval(text)


def typed(value: str, schema: dict) -> Any:
    """Type an XML parameter value by its schema; a value that does not fit stays a string."""
    kind = (schema or {}).get("type")
    try:
        if kind == "string":
            return value
        if kind == "integer":
            return int(value.strip())
        if kind in ("float", "number"):
            number = float(value.strip())
            return int(number) if kind == "number" and number.is_integer() and "." not in value else number
        if kind == "boolean":
            lowered = value.strip().lower()
            if lowered in ("true", "false"):
                return lowered == "true"
            raise ValueError(value)
        return _literal(value.strip())
    except (ValueError, SyntaxError):
        return value


def xml_calls_to_json(text: str, functions: list[dict]) -> str:
    """Rewrite Qwen3.5 XML tool calls as Qwen3 JSON tool calls; text without calls is unchanged."""
    calls = CALL.findall(text)
    if not calls:
        return text
    schemas = {f["name"]: (f.get("parameters") or {}).get("properties") or {} for f in functions}
    rewritten = []
    for name, body in calls:
        name = name.strip()
        properties = schemas.get(name, {})
        arguments = {key.strip(): typed(value, properties.get(key.strip(), {})) for key, value in PARAMETER.findall(body)}
        rewritten.append("<tool_call>\n" + json.dumps({"name": name, "arguments": arguments}) + "\n</tool_call>")
    return "\n".join(rewritten)


class Qwen35FCHandler(QwenFCHandler):
    @override
    def _format_prompt(self, messages, function):
        tools = [{"type": "function", "function": f} for f in function] or None
        return self.tokenizer.apply_chat_template(
            messages, tools=tools, add_generation_prompt=True, tokenize=False, enable_thinking=False)

    @override
    def _query_prompting(self, inference_data: dict):
        api_response, latency = super()._query_prompting(inference_data)
        choice = api_response.choices[0]
        choice.text = xml_calls_to_json(choice.text, inference_data["function"])
        return api_response, latency


for registry, display, url in [
    ("qwen3.5-0.8b-FC", "Qwen3.5-0.8B (FC)", "https://huggingface.co/Qwen/Qwen3.5-0.8B"),
    ("hydra-nano-v2-FC", "Hydra Nano v2 (FC)", "https://huggingface.co/rahul05ranjan/hydra-nano-git"),
]:
    MODEL_CONFIG_MAPPING[registry] = ModelConfig(
        model_name=registry, display_name=display, url=url, org="Hydra", license="apache-2.0",
        model_handler=Qwen35FCHandler, input_price=None, output_price=None, is_fc_model=True, underscore_to_dot=False)

if __name__ == "__main__":
    cli()
