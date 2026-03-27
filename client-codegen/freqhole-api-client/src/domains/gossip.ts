// gossip domain methods for FreqholeClient

import { routes } from "../codegen/routes.js";
import type * as s from "../codegen/schema.js";
import type { CallFn } from "./types.js";

export function createGossipMethods(call: CallFn) {
  return {
    // channels
    createChannel: (params: s.CreateChannelRequest) => {
      const r = routes.gossip.create_gossip_channel;
      return call("gossip", "create_gossip_channel", r.resp, r.req, r.method, r.path, params);
    },

    listChannels: () => {
      const r = routes.gossip.list_gossip_channels;
      return call("gossip", "list_gossip_channels", r.resp, r.req, r.method, r.path, {});
    },

    getChannel: (params: s.GetChannelRequest) => {
      const r = routes.gossip.get_gossip_channel;
      return call("gossip", "get_gossip_channel", r.resp, r.req, r.method, r.path, params);
    },

    leaveChannel: (params: s.GetChannelRequest) => {
      const r = routes.gossip.leave_gossip_channel;
      return call("gossip", "leave_gossip_channel", r.resp, r.req, r.method, r.path, params);
    },

    joinChannel: (params: s.JoinChannelRequest) => {
      const r = routes.gossip.join_gossip_channel;
      return call("gossip", "join_gossip_channel", r.resp, r.req, r.method, r.path, params);
    },

    getInvite: (params: s.GetChannelRequest) => {
      const r = routes.gossip.get_gossip_channel_invite;
      return call("gossip", "get_gossip_channel_invite", r.resp, r.req, r.method, r.path, params);
    },

    // messages
    getMessages: (params: s.GetMessagesWithChannelRequest) => {
      const r = routes.gossip.get_gossip_messages;
      return call("gossip", "get_gossip_messages", r.resp, r.req, r.method, r.path, params);
    },

    sendMessage: (params: s.SendMessageWithChannelRequest) => {
      const r = routes.gossip.send_gossip_message;
      return call("gossip", "send_gossip_message", r.resp, r.req, r.method, r.path, params);
    },

    // reactions
    react: (params: s.ReactWithChannelRequest) => {
      const r = routes.gossip.react_gossip_message;
      return call("gossip", "react_gossip_message", r.resp, r.req, r.method, r.path, params);
    },

    // message management
    deleteMessage: (params: s.DeleteMessageRequest) => {
      const r = routes.gossip.delete_gossip_message;
      return call("gossip", "delete_gossip_message", r.resp, r.req, r.method, r.path, params);
    },

    // members
    listMembers: (params: s.GetChannelRequest) => {
      const r = routes.gossip.list_gossip_members;
      return call("gossip", "list_gossip_members", r.resp, r.req, r.method, r.path, params);
    },

    // profile
    getProfile: () => {
      const r = routes.gossip.get_gossip_profile;
      return call("gossip", "get_gossip_profile", r.resp, r.req, r.method, r.path, {});
    },

    updateProfile: (params: s.UpdateProfileRequest) => {
      const r = routes.gossip.update_gossip_profile;
      return call("gossip", "update_gossip_profile", r.resp, r.req, r.method, r.path, params);
    },
  };
}
