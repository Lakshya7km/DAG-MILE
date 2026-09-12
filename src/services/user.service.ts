type User = {
  id: number;
  name: string;
  age: number;
};

const Users: User[] = [];
let id: number = 0;
const createUserService = (name: string, age: number) => {
  id++;
  Users.push({
    id,
    name,
    age,
  });

  return {
    id,
    name,
    age,
  };
};

const getUserServiceByIdService = (Id: number) => {
  for (const el of Users) {
    if (el.id === Id) {
      return el;
    }
  }
  return undefined;
};
const getUsersService = () => {
  return Users;
};

type UserUpdate = {
  name?: string;
  age?: number;
};

const updateUserService = (id:number,updates:UserUpdate) => {
      for(const user of Users){
        if(user.id==id){
          if(updates.name!==undefined){
            user.name=updates.name
          }
          if(updates.age!=undefined){
            user.age=updates.age
          }

          return user;
        }
      }

      return undefined;
  }

  const deleteUserService = (id: number) => {
  // find the user
const index = Users.findIndex((user) => user.id === id);
  if (index === -1) {
    return undefined;
  }
  // remove the user
    const deletedUser = Users[index];
  Users.splice(index,1);
  // return the deleted user
 return deletedUser;
  // return undefined if user doesn't exist
};

export {
  getUserServiceByIdService,
  createUserService,
  getUsersService,
  updateUserService,
  deleteUserService
};
