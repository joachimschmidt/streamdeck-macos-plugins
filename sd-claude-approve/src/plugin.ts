import streamDeck from "@elgato/streamdeck";
import { ClaudeApproveAction } from "./claude-approve-action";

streamDeck.actions.registerAction(new ClaudeApproveAction());
streamDeck.connect();
