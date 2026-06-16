module.exports = (sequelize, DataTypes) => {
  const Movie = sequelize.define('Movie', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    title: {
      type: DataTypes.STRING
    },
    duration: {
      type: DataTypes.INTEGER
    },
    genre: {
      type: DataTypes.STRING
    },
    rating: {
      type: DataTypes.FLOAT
    },
    poster: {
      type: DataTypes.STRING
    },
    status: {
      type: DataTypes.ENUM('showing', 'upcoming', 'offline')
    }
  }, {
    tableName: 'Movies'
  });

  Movie.associate = (models) => {
    Movie.hasMany(models.Schedule, { foreignKey: 'movieId' });
  };

  return Movie;
};
