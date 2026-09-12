import type { Request, Response } from "express";
import {
  createUserService,
  deleteUserService,
  getUserServiceByIdService,
  getUsersService,
  updateUserService,
} from "../services/user.service.js";
const createUser = (req: Request, res: Response) => {
  const { name, age } = req.body;

  if (typeof name !== "string" || typeof age !== "number") {
    return res.status(400).json({
      message: "Bad Request",
    });
  }
  //check user is 18+ or not
  res.status(201).json({
    message: "Received",
    Result: createUserService(name, age),
  });
  // res.status(200).json({
  //   message: "User Received",
  //   name,
  //   age,
  // });
};

const getUserById = (req: Request, res: Response) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      message: "Invalid user id",
    });
  }

  const user = getUserServiceByIdService(id);

  if (user === undefined) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  res.status(200).json({
    message: "User found",
    result: user,
  });
};

const getUsers = (req: Request, res: Response) => {
  res.status(200).json({
    result: getUsersService(),
  });
};

const updateUser = (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { name, age } = req.body;

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      message: "Invalid user id",
    });
  }

  if (name !== undefined && typeof name !== "string") {
    return res.status(400).json({
      message: "Invalid name",
    });
  }

  if (age !== undefined && typeof age !== "number") {
    return res.status(400).json({
      message: "Invalid age",
    });
  }
  const updatedUser = updateUserService(id, { name, age });
  if (updatedUser === undefined) {
    return res.status(404).json({
      message: "User not found",
    });
  }
  res.status(200).json({
    message: "User Updated",
    result: updatedUser,
  });
};

const deleteUser = (req: Request, res: Response) => {
  const id = Number(req.params.id);

  if (!Number.isInteger(id)) {
    return res.status(400).json({
      message: "Invalid user id",
    });
  }

  const deletedUser = deleteUserService(id);

  if (deletedUser === undefined) {
    return res.status(404).json({
      message: "User not found",
    });
  }

  res.status(200).json({
    message: "User Deleted",
    result: deletedUser,
  });
};

export { createUser, getUserById, getUsers, updateUser, deleteUser };
