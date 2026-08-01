import os
import unittest
from unittest.mock import Mock, patch

import app as backend


class PostPublishingTests(unittest.TestCase):
    def test_publish_uses_each_targets_ai_caption(self):
        api_one = Mock(last_graph_error='')
        api_one.create_post.return_value = {'id': 'group-1_post-1'}
        api_two = Mock(last_graph_error='')
        api_two.create_post.return_value = {'id': 'group-2_post-2'}
        clients = {'group-1': api_one, 'group-2': api_two}

        with patch.object(backend, 'get_api', side_effect=lambda group_id: clients[group_id]):
            result = backend._publish_content_pipeline_post(
                {'content': 'Nội dung chung'},
                [
                    {'type': 'group', 'id': 'group-1', 'name': 'Nhóm 1', 'message': 'Caption riêng 1'},
                    {'type': 'group', 'id': 'group-2', 'name': 'Nhóm 2', 'caption': 'Caption riêng 2'},
                ],
            )

        self.assertTrue(result['ok'])
        self.assertEqual(result['success_count'], 2)
        self.assertEqual(api_one.create_post.call_args.args[0], 'Caption riêng 1')
        self.assertEqual(api_two.create_post.call_args.args[0], 'Caption riêng 2')

    def test_generic_group_error_explains_meta_groups_api_limit(self):
        message, diagnostics = backend._facebook_publish_error({
            'error': {
                'message': 'An unknown error has occurred.',
                'type': 'OAuthException',
                'code': 1,
                'fbtrace_id': 'trace-123',
            },
        }, 'group')

        self.assertIn('Groups API', message)
        self.assertIn('Facebook #1', message)
        self.assertEqual(diagnostics['facebook_error_code'], 1)
        self.assertEqual(diagnostics['facebook_trace_id'], 'trace-123')

    def test_server_groq_key_is_used_when_saved_provider_has_no_key(self):
        config = {
            'provider': 'gemini',
            'model': 'gemini-3.1-pro-preview',
            'keys': {'gemini': '', 'groq': ''},
            'categories': [],
        }
        with (
            patch.object(backend, '_effective_ai_config', return_value=(config, 'global', '')),
            patch.dict(os.environ, {'AI_PROVIDER': 'groq', 'GROQ_API_KEY': 'server-groq-key'}, clear=False),
        ):
            classifier = backend._get_classifier()

        self.assertEqual(classifier.provider, 'groq')
        self.assertEqual(classifier.model, 'llama-3.3-70b-versatile')
        self.assertEqual(classifier.api_key, 'server-groq-key')


if __name__ == '__main__':
    unittest.main()
