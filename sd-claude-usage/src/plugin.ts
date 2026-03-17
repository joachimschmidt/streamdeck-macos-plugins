import streamDeck from "@elgato/streamdeck";
import { ClaudeUsageAction } from "./usage-action";

streamDeck.actions.registerAction(new ClaudeUsageAction());
streamDeck.connect();
