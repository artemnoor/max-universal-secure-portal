// This fixture must stay outside the production module tree. It proves the boundary checker rejects transport/infrastructure imports.
import { Bot } from '@maxhub/max-bot-api';

export const unsafeFixture = Bot;
