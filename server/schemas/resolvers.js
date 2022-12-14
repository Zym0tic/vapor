const { AuthenticationError } = require('apollo-server-express');
const { User, Game, Genre, Order } = require('../models');
const { signToken } = require('../utils/auth');
const stripe = require('stripe')('sk_test_51Ln50pIzwEkah6ebwmGbgYFyXRDFqEVTL8uOyGTPRhx0tmsnOrUJ2IWmPcMunhCGoIincx4dOYLj5TxJlBWpexeq00HxrPoAkJ');

const resolvers = {
  Query: {
    genres: async () => {
      return await Genre.find();
    },
    games: async (parent, { genre, title }) => {
      const params = {};

      if (genre) {
        params.genre = genre;
      }

      if (title) {
        params.title = {
          $regex: title
        };
      }

      return await Game.find(params).populate('genres');
    },
    game: async (parent, { _id }) => {
      return await Game.findById(_id).populate('genres');
    },
    user: async (parent, args, context) => {
      if (context.user) {
        const user = await User.findById(context.user._id).populate({
          path: 'orders.games',
          populate: 'genres'
        });

        user.orders.sort((a, b) => b.purchaseDate - a.purchaseDate);

        return user;
      }

      throw new AuthenticationError('Not logged in');
    },
    order: async (parent, { _id }, context) => {
      if (context.user) {
        const user = await User.findById(context.user._id).populate({
          path: 'orders.games',
          populate: 'genres'
        });

        return user.orders.id(_id);
      }

      throw new AuthenticationError('Not logged in');
    },
    checkout: async (parent, args, context) => {
      const url = new URL(context.headers.referer).origin;
      const order = new Order({ games: args.games });
      const line_items = [];

      const { games } = await order.populate('games');

      for (let i = 0; i < games.length; i++) {
        const game = await stripe.games.create({
          title: games[i].name,
          description: games[i].description,
          images: [`${url}/images/${games[i].image}`]
        });

        const price = await stripe.prices.create({
          game: game.id,
          unit_amount: games[i].price * 100,
          currency: 'usd',
        });

        line_items.push({
          price: price.id,
          quantity: 1
        });
      }

      const session = await stripe.checkout.sessions.create({
        payment_method_types: ['card'],
        line_items,
        mode: 'payment',
        success_url: `${url}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${url}/`
      });

      return { session: session.id };
    }
  },
  Mutation: {
    addUser: async (parent, {firstName, lastName, userName, email, password}) => {
      console.log({firstName, lastName, userName, email, password});
      const user = await User.create({firstName, lastName, userName, email, password});
      const token = signToken(user);

      return { token, user };
    },
    addOrder: async (parent, { games }, context) => {
      console.log(context);
      if (context.user) {
        const order = new Order({ games });

        await User.findByIdAndUpdate(context.user._id, { $push: { orders: order } });

        return order;
      }

      throw new AuthenticationError('Not logged in');
    },
    updateUser: async (parent, {firstName, lastName, userName, email, password}, context) => {
      if (context.user) {
        return await User.findByIdAndUpdate(context.user._id, {firstName, lastName, userName, email, password}, { new: true });
      }

      throw new AuthenticationError('Not logged in');
    },
    updateGame: async (parent, { _id, quantity }) => {
      const decrement = Math.abs(quantity) * -1;

      return await Game.findByIdAndUpdate(_id, { $inc: { quantity: decrement } }, { new: true });
    },
    login: async (parent, { email, password }) => {
      const user = await User.findOne({ email });

      console.log(email, password);

      if (!user) {
        throw new AuthenticationError('Incorrect credentials');
      }

      const correctPw = await user.isCorrectPassword(password);
      console.log(correctPw);
      console.log(user);
      console.log(password);

      if (!correctPw) {
        throw new AuthenticationError('Incorrect credentials');
      }

      const token = signToken(user);

      return { token, user };
    }
  }
};

module.exports = resolvers;
