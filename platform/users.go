// Copyright (c) 2022-2024 Winlin
//
// SPDX-License-Identifier: MIT
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sort"
	"strings"
	"time"

	// From ossrs.
	"github.com/ossrs/go-oryx-lib/errors"
	ohttp "github.com/ossrs/go-oryx-lib/http"
	"github.com/ossrs/go-oryx-lib/logger"

	// Use v8 because we use Go 1.16+, while v9 requires Go 1.18+
	"github.com/go-redis/redis/v8"
	"github.com/google/uuid"
)

const (
	RoleOwner  = "owner"
	RoleEditor = "editor"
)

var userManager *UserManager

// UserManager handles CRUD operations for simulcast users stored in Redis.
type UserManager struct{}

func NewUserManager() *UserManager {
	return &UserManager{}
}

// SimulcastUser represents a user of the simulcasting management application.
type SimulcastUser struct {
	ID        string `json:"id"`
	FirstName string `json:"firstName"`
	LastName  string `json:"lastName"`
	Email     string `json:"email"`
	Role      string `json:"role"` // "owner" or "editor"
	CreatedAt string `json:"createdAt"`
}

func (v *SimulcastUser) String() string {
	return fmt.Sprintf("id=%v, email=%v, role=%v", v.ID, v.Email, v.Role)
}

func (v *UserManager) Handle(ctx context.Context, handler *http.ServeMux) error {
	ep := "/terraform/v1/mgmt/users"
	logger.Tf(ctx, "Handle %v", ep)
	handler.HandleFunc(ep, func(w http.ResponseWriter, r *http.Request) {
		if err := func() error {
			var token, action, callerEmail string
			var userReq SimulcastUser
			if err := ParseBody(ctx, r.Body, &struct {
				Token       *string `json:"token"`
				Action      *string `json:"action"`
				CallerEmail *string `json:"callerEmail"`
				*SimulcastUser
			}{
				Token: &token, Action: &action, CallerEmail: &callerEmail, SimulcastUser: &userReq,
			}); err != nil {
				return errors.Wrapf(err, "parse body")
			}

			apiSecret := envApiSecret()
			if err := Authenticate(ctx, apiSecret, token, r.Header); err != nil {
				return errors.Wrapf(err, "authenticate")
			}

			allowedActions := []string{"create", "update", "delete"}
			if action != "" && !slicesContains(allowedActions, action) {
				return errors.Errorf("invalid action=%v", action)
			}

			// Role enforcement for mutating actions.
			// Bootstrap exception: if the user store is empty, the first create is allowed without a caller.
			if action == "create" || action == "update" || action == "delete" {
				count, err := rdb.HLen(ctx, SIMULCAST_USERS).Result()
				if err != nil && err != redis.Nil {
					return errors.Wrapf(err, "hlen %v", SIMULCAST_USERS)
				}
				// If callerEmail is provided (Entra flow), enforce owner role.
				// If empty, the caller authenticated via admin password (bearer token),
				// which already implies full access - no additional role check needed.
				if count > 0 && callerEmail != "" {
					callerRole, err := v.getUserRole(ctx, callerEmail)
					if err != nil {
						return errors.Wrapf(err, "get caller role for %v", callerEmail)
					}
					if callerRole != RoleOwner {
						return errors.Errorf("permission denied: %v has role %v, owner required", callerEmail, callerRole)
					}
				}
			}

			switch action {
			case "create":
				if err := validateUserFields(&userReq); err != nil {
					return err
				}
				userReq.Email = strings.ToLower(strings.TrimSpace(userReq.Email))
				if exists, err := v.emailExists(ctx, userReq.Email, ""); err != nil {
					return errors.Wrapf(err, "check email")
				} else if exists {
					return errors.Errorf("email %v is already in use", userReq.Email)
				}

				user := SimulcastUser{
					ID:        uuid.NewString(),
					FirstName: strings.TrimSpace(userReq.FirstName),
					LastName:  strings.TrimSpace(userReq.LastName),
					Email:     userReq.Email,
					Role:      userReq.Role,
					CreatedAt: time.Now().Format(time.RFC3339),
				}
				b, err := json.Marshal(&user)
				if err != nil {
					return errors.Wrapf(err, "marshal user")
				}
				if err := rdb.HSet(ctx, SIMULCAST_USERS, user.ID, string(b)).Err(); err != nil && err != redis.Nil {
					return errors.Wrapf(err, "hset %v %v", SIMULCAST_USERS, user.ID)
				}

				ohttp.WriteData(ctx, w, r, user)
				logger.Tf(ctx, "Users create ok, user=%v, token=%vB", user.String(), len(token))

			case "update":
				if userReq.ID == "" {
					return errors.New("id is required")
				}
				if err := validateUserFields(&userReq); err != nil {
					return err
				}
				userReq.Email = strings.ToLower(strings.TrimSpace(userReq.Email))

				raw, err := rdb.HGet(ctx, SIMULCAST_USERS, userReq.ID).Result()
				if err == redis.Nil {
					return errors.Errorf("user %v not found", userReq.ID)
				} else if err != nil {
					return errors.Wrapf(err, "hget %v %v", SIMULCAST_USERS, userReq.ID)
				}
				var current SimulcastUser
				if err := json.Unmarshal([]byte(raw), &current); err != nil {
					return errors.Wrapf(err, "unmarshal user")
				}

				if exists, err := v.emailExists(ctx, userReq.Email, userReq.ID); err != nil {
					return errors.Wrapf(err, "check email")
				} else if exists {
					return errors.Errorf("email %v is already in use", userReq.Email)
				}

				current.FirstName = strings.TrimSpace(userReq.FirstName)
				current.LastName = strings.TrimSpace(userReq.LastName)
				current.Email = userReq.Email
				current.Role = userReq.Role

				b, err := json.Marshal(&current)
				if err != nil {
					return errors.Wrapf(err, "marshal user")
				}
				if err := rdb.HSet(ctx, SIMULCAST_USERS, current.ID, string(b)).Err(); err != nil && err != redis.Nil {
					return errors.Wrapf(err, "hset %v %v", SIMULCAST_USERS, current.ID)
				}

				ohttp.WriteData(ctx, w, r, current)
				logger.Tf(ctx, "Users update ok, user=%v, token=%vB", current.String(), len(token))

			case "delete":
				if userReq.ID == "" {
					return errors.New("id is required")
				}
				raw, err := rdb.HGet(ctx, SIMULCAST_USERS, userReq.ID).Result()
				if err == redis.Nil {
					return errors.Errorf("user %v not found", userReq.ID)
				} else if err != nil {
					return errors.Wrapf(err, "hget %v %v", SIMULCAST_USERS, userReq.ID)
				}
				var target SimulcastUser
				if err := json.Unmarshal([]byte(raw), &target); err != nil {
					return errors.Wrapf(err, "unmarshal user")
				}
				if callerEmail != "" && strings.EqualFold(target.Email, callerEmail) {
					return errors.New("cannot delete your own account")
				}

				if err := rdb.HDel(ctx, SIMULCAST_USERS, userReq.ID).Err(); err != nil && err != redis.Nil {
					return errors.Wrapf(err, "hdel %v %v", SIMULCAST_USERS, userReq.ID)
				}

				ohttp.WriteData(ctx, w, r, nil)
				logger.Tf(ctx, "Users delete ok, id=%v, token=%vB", userReq.ID, len(token))

			default: // list
				users, err := v.listUsers(ctx)
				if err != nil {
					return errors.Wrapf(err, "list users")
				}
				ohttp.WriteData(ctx, w, r, users)
				logger.Tf(ctx, "Users list ok, count=%v, token=%vB", len(users), len(token))
			}

			return nil
		}(); err != nil {
			ohttp.WriteError(ctx, w, r, err)
		}
	})

	return nil
}

func validateUserFields(u *SimulcastUser) error {
	if strings.TrimSpace(u.FirstName) == "" {
		return errors.New("firstName is required")
	}
	if strings.TrimSpace(u.LastName) == "" {
		return errors.New("lastName is required")
	}
	if strings.TrimSpace(u.Email) == "" {
		return errors.New("email is required")
	}
	if u.Role != RoleOwner && u.Role != RoleEditor {
		return errors.Errorf("role must be %q or %q", RoleOwner, RoleEditor)
	}
	return nil
}

func (v *UserManager) getUserRole(ctx context.Context, email string) (string, error) {
	all, err := rdb.HGetAll(ctx, SIMULCAST_USERS).Result()
	if err != nil && err != redis.Nil {
		return "", errors.Wrapf(err, "hgetall %v", SIMULCAST_USERS)
	}
	for _, raw := range all {
		var u SimulcastUser
		if err := json.Unmarshal([]byte(raw), &u); err != nil {
			continue
		}
		if strings.EqualFold(u.Email, email) {
			return u.Role, nil
		}
	}
	return "", errors.Errorf("user with email %v not found", email)
}

func (v *UserManager) emailExists(ctx context.Context, email, excludeID string) (bool, error) {
	all, err := rdb.HGetAll(ctx, SIMULCAST_USERS).Result()
	if err != nil && err != redis.Nil {
		return false, errors.Wrapf(err, "hgetall %v", SIMULCAST_USERS)
	}
	for _, raw := range all {
		var u SimulcastUser
		if err := json.Unmarshal([]byte(raw), &u); err != nil {
			continue
		}
		if strings.EqualFold(u.Email, email) && u.ID != excludeID {
			return true, nil
		}
	}
	return false, nil
}

func (v *UserManager) listUsers(ctx context.Context) ([]*SimulcastUser, error) {
	all, err := rdb.HGetAll(ctx, SIMULCAST_USERS).Result()
	if err != nil && err != redis.Nil {
		return nil, errors.Wrapf(err, "hgetall %v", SIMULCAST_USERS)
	}
	users := make([]*SimulcastUser, 0, len(all))
	for _, raw := range all {
		var u SimulcastUser
		if err := json.Unmarshal([]byte(raw), &u); err != nil {
			return nil, errors.Wrapf(err, "unmarshal user")
		}
		users = append(users, &u)
	}
	sort.Slice(users, func(i, j int) bool {
		return users[i].CreatedAt < users[j].CreatedAt
	})
	return users, nil
}
